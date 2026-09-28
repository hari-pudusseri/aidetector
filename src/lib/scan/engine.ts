import { SCAN_PROMPT_VERSION, type ScanConfig } from "@/lib/scan/config";
import { chunkPayload, chunkSentences, type ScanChunk } from "@/lib/scan/chunks";
import type { ScanEvent, ScanEventBody } from "@/lib/scan/events";
import { newScanId, revisionHash } from "@/lib/scan/ids";
import { parseJsonObject } from "@/lib/scan/json";
import { repairUserMessage, REVIEW_SYSTEM_PROMPT, SCAN_SYSTEM_PROMPT } from "@/lib/scan/prompt";
import { summarizeChunks } from "@/lib/scan/review";
import { reviewResponseSchema } from "@/lib/scan/schema";
import { chunkChars, chunkTargetRanges, localSummary, scoreDocument, type ChunkAssessment } from "@/lib/scan/score";
import { reconstruct, segmentSentences } from "@/lib/scan/sentences";
import { alignAnnotations, parseChunkResponse, type AlignedAnnotation } from "@/lib/scan/validate";
import { MuseRequestError, museCompleteWithRetry, type MuseConfig } from "@/lib/muse";

export type ScanRequest = {
	text: string;
	scanId?: string;
	retryChunkIds?: string[];
	signal?: AbortSignal;
	muse: MuseConfig;
	config: ScanConfig;
};

function prepareSource(text: string, maxChars: number): string {
	if (!text.trim()) {
		throw new Error("Paste some prose first.");
	}
	if (text.length > maxChars) {
		throw new Error(`Keep the sample under ${maxChars.toLocaleString()} characters.`);
	}
	return text;
}

export async function* runScan(request: ScanRequest): AsyncGenerator<ScanEvent> {
	const queue: ScanEvent[] = [];
	const gate: { wake: (() => void) | null } = { wake: null };
	let finished = false;
	let failure: Error | null = null;

	const push = (event: ScanEvent) => {
		queue.push(event);
		gate.wake?.();
	};

	const work = (async () => {
		try {
			await executeScan(request, push);
		} catch (error) {
			failure = error instanceof Error ? error : new Error("Scan failed");
		} finally {
			finished = true;
			gate.wake?.();
		}
	})();

	while (!finished || queue.length > 0) {
		if (queue.length === 0) {
			await new Promise<void>((resolve) => {
				gate.wake = resolve;
			});
			gate.wake = null;
		}
		while (queue.length > 0) {
			yield queue.shift()!;
		}
	}
	await work;
	if (failure) throw failure;
}

async function executeScan(request: ScanRequest, push: (event: ScanEvent) => void) {
	const scanId = request.scanId || newScanId();
	const revision = revisionHash(request.text);
	let seq = 0;
	const emit = (event: ScanEventBody) => {
		push({ ...event, scanId, seq: (seq += 1) } as ScanEvent);
	};

	try {
		const source = prepareSource(request.text, request.config.maxDocumentChars);
		const sentences = segmentSentences(source, request.config.oversizedSentenceTokens);
		if (reconstruct(sentences) !== source) {
			throw new Error("Sentence segmentation failed to preserve the source text.");
		}
		let chunks = chunkSentences(sentences, request.config);
		if (request.retryChunkIds?.length) {
			const allowed = new Set(request.retryChunkIds);
			chunks = chunks.filter((chunk) => allowed.has(chunk.id));
			if (chunks.length === 0) {
				throw new Error("No matching chunks to retry.");
			}
		}

		emit(
			({
				type: "scan_started",
				chunkCount: chunks.length,
				sentenceCount: sentences.length,
				promptVersion: SCAN_PROMPT_VERSION,
				revision,
			}),
		);

		const assessments: ChunkAssessment[] = [];
		const annotations: AlignedAnnotation[] = [];
		const failedChunks: string[] = [];
		let completed = 0;

		const cancelled = () => Boolean(request.signal?.aborted);

		const runChunk = async (chunk: ScanChunk) => {
			if (cancelled()) return;
			emit(
				({
					type: "chunk_started",
					chunkId: chunk.id,
					index: chunk.index,
					total: chunks.length,
				}),
			);
			try {
				const result = await analyzeChunk(source, chunk, request);
				if (cancelled()) return;
				assessments.push(result.assessment);
				annotations.push(...result.annotations);
				completed += 1;
				emit(
					({
						type: "chunk_result",
						chunkId: chunk.id,
						annotations: result.annotations,
						assessment: result.assessment,
						dropped: result.dropped,
					}),
				);
			} catch (error) {
				if (error instanceof MuseRequestError && error.code === "cancelled") return;
				if (error instanceof MuseRequestError && error.code === "auth") throw error;
				const message = error instanceof Error ? error.message : "Chunk failed";
				const retryable = error instanceof MuseRequestError ? error.retryable : true;
				failedChunks.push(chunk.id);
				completed += 1;
				assessments.push({
					chunkId: chunk.id,
					signal: "none",
					genre: "unknown",
					note: "",
					analyzedChars: 0,
					ranges: [],
					failed: true,
				});
				emit(
					({
						type: "chunk_failed",
						chunkId: chunk.id,
						message,
						retryable,
					}),
				);
			}
			if (cancelled()) return;
			emit(
				({
					type: "progress",
					completed,
					failed: failedChunks.length,
					total: chunks.length,
					scores: scoreDocument(source.length, assessments, annotations, { preliminary: true }),
				}),
			);
		};

		await runPool(chunks, request.config.concurrency, runChunk, request.signal);

		if (cancelled()) {
			emit(
				({
					type: "scan_cancelled",
					completed,
					total: chunks.length,
				}),
			);
			return;
		}

		const scores = scoreDocument(source.length, assessments, annotations, { preliminary: false });
		let summary = localSummary(scores);

		if (request.config.reviewEnabled && assessments.some((item) => !item.failed)) {
			try {
				const review = await runReview(assessments, annotations, request);
				summary = review.summary;
				emit(
					({
						type: "document_review",
						review,
						source: "model",
					}),
				);
			} catch (error) {
				if (!(error instanceof MuseRequestError && error.code === "cancelled")) {
					emit(
						({
							type: "document_review",
							review: {
								summary,
								repeated_patterns: [],
								structural_notes: "",
								limitations: "Document review was unavailable; this summary uses chunk notes only.",
							},
							source: "local",
						}),
					);
				}
			}
		}

		if (cancelled()) {
			emit(
				({
					type: "scan_cancelled",
					completed,
					total: chunks.length,
				}),
			);
			return;
		}

		emit(
			({
				type: "scan_completed",
				scores,
				summary,
				failedChunks,
			}),
		);
	} catch (error) {
		if (error instanceof MuseRequestError && error.code === "cancelled") {
			emit(
				({
					type: "scan_cancelled",
					completed: 0,
					total: 0,
				}),
			);
			return;
		}
		emit(
			({
				type: "scan_error",
				message: error instanceof Error ? error.message : "Scan failed",
			}),
		);
	}
}

async function analyzeChunk(
	source: string,
	chunk: ScanChunk,
	request: ScanRequest,
): Promise<{ annotations: AlignedAnnotation[]; assessment: ChunkAssessment; dropped: number }> {
	const user = JSON.stringify(chunkPayload(chunk));
	let completion = await museCompleteWithRetry(request.muse, SCAN_SYSTEM_PROMPT, user, {
		signal: request.signal,
		timeoutMs: request.config.timeoutMs,
		retryLimit: request.config.retryLimit,
	});
	let parsedUnknown: unknown;
	try {
		parsedUnknown = parseJsonObject(completion.text);
	} catch (error) {
		const repaired = await museCompleteWithRetry(
			request.muse,
			SCAN_SYSTEM_PROMPT,
			repairUserMessage(user, error instanceof Error ? error.message : "Invalid JSON"),
			{
				signal: request.signal,
				timeoutMs: request.config.timeoutMs,
				retryLimit: 0,
			},
		);
		parsedUnknown = parseJsonObject(repaired.text);
	}

	let parsed = parseChunkResponse(parsedUnknown);
	if (!parsed.ok) {
		const repaired = await museCompleteWithRetry(
			request.muse,
			SCAN_SYSTEM_PROMPT,
			repairUserMessage(user, parsed.error),
			{
				signal: request.signal,
				timeoutMs: request.config.timeoutMs,
				retryLimit: 0,
			},
		);
		parsed = parseChunkResponse(parseJsonObject(repaired.text));
		if (!parsed.ok) {
			throw new Error("Chunk response could not be validated.");
		}
	}

	const aligned = alignAnnotations(source, chunk, parsed.value, request.config);
	return {
		annotations: aligned.annotations,
		dropped: aligned.report.dropped,
		assessment: {
			chunkId: chunk.id,
			signal: parsed.value.assessment.signal,
			genre: parsed.value.assessment.genre,
			note: parsed.value.assessment.note,
			analyzedChars: chunkChars(chunk),
			ranges: chunkTargetRanges(chunk),
			failed: false,
		},
	};
}

async function runReview(
	assessments: ChunkAssessment[],
	annotations: AlignedAnnotation[],
	request: ScanRequest,
) {
	const payload = {
		chunks: summarizeChunks(assessments, annotations, request.config.reviewInputTokens),
	};
	const completion = await museCompleteWithRetry(
		request.muse,
		REVIEW_SYSTEM_PROMPT,
		JSON.stringify(payload),
		{
			signal: request.signal,
			timeoutMs: request.config.timeoutMs,
			retryLimit: Math.min(1, request.config.retryLimit),
		},
	);
	const parsed = reviewResponseSchema.safeParse(parseJsonObject(completion.text));
	if (!parsed.success) {
		throw new Error("Review response was invalid.");
	}
	return parsed.data;
}

async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
	signal?: AbortSignal,
): Promise<void> {
	let cursor = 0;
	const limit = Math.max(1, concurrency);
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			if (signal?.aborted) return;
			const index = cursor;
			cursor += 1;
			await worker(items[index]);
		}
	});
	await Promise.all(runners);
}
