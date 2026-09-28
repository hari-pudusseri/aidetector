import type { ScanConfig } from "@/lib/scan/config";
import type { ScanChunk } from "@/lib/scan/chunks";
import type { Sentence } from "@/lib/scan/sentences";
import {
	AI_PATTERNS,
	COUNTER_PATTERNS,
	chunkResponseSchema,
	type AnnotationKind,
	type ChunkResponse,
	type PatternCode,
	type RawAnnotation,
} from "@/lib/scan/schema";

export type AlignedAnnotation = {
	sentenceId: string;
	chunkId: string;
	quote: string;
	kind: AnnotationKind;
	patterns: PatternCode[];
	strength: 1 | 2 | 3;
	reason: string;
	start: number;
	end: number;
};

export type ValidationReport = {
	dropped: number;
	kept: number;
	errors: string[];
	repaired: boolean;
};

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let from = 0;
	while (from <= haystack.length - needle.length) {
		const index = haystack.indexOf(needle, from);
		if (index === -1) break;
		count += 1;
		from = index + 1;
	}
	return count;
}

function patternsMatchKind(kind: AnnotationKind, patterns: PatternCode[]): boolean {
	if (kind === "ai_style") {
		return patterns.every((code) => (AI_PATTERNS as readonly string[]).includes(code));
	}
	return patterns.every((code) => (COUNTER_PATTERNS as readonly string[]).includes(code));
}

export function locateQuoteInSentence(sentence: Sentence, quote: string): { start: number; end: number } | null {
	const local = sentence.text.indexOf(quote);
	if (local === -1) return null;
	if (countOccurrences(sentence.text, quote) !== 1) return null;
	const start = sentence.start + local;
	const end = start + quote.length;
	return { start, end };
}

export function alignAnnotations(
	source: string,
	chunk: ScanChunk,
	payload: ChunkResponse,
	config: ScanConfig,
): { annotations: AlignedAnnotation[]; report: ValidationReport } {
	const targetIds = new Set(chunk.target.map((sentence) => sentence.id));
	const byId = new Map(chunk.target.map((sentence) => [sentence.id, sentence]));
	const errors: string[] = [];
	const annotations: AlignedAnnotation[] = [];
	let dropped = 0;

	for (const raw of payload.annotations.slice(0, config.maxAnnotationsPerChunk)) {
		if (!targetIds.has(raw.sentence_id)) {
			dropped += 1;
			errors.push(`context_or_unknown_sentence:${raw.sentence_id}`);
			continue;
		}
		if (!patternsMatchKind(raw.kind, raw.patterns)) {
			dropped += 1;
			errors.push(`pattern_kind_mismatch:${raw.sentence_id}`);
			continue;
		}
		if (raw.reason.length > config.maxReasonChars) {
			dropped += 1;
			errors.push(`reason_too_long:${raw.sentence_id}`);
			continue;
		}
		const sentence = byId.get(raw.sentence_id);
		if (!sentence) {
			dropped += 1;
			continue;
		}
		const located = locateQuoteInSentence(sentence, raw.quote);
		if (!located) {
			dropped += 1;
			errors.push(`quote_unaligned:${raw.sentence_id}`);
			continue;
		}
		if (source.slice(located.start, located.end) !== raw.quote) {
			dropped += 1;
			errors.push(`offset_mismatch:${raw.sentence_id}`);
			continue;
		}
		annotations.push({
			sentenceId: raw.sentence_id,
			chunkId: chunk.id,
			quote: raw.quote,
			kind: raw.kind,
			patterns: raw.patterns,
			strength: raw.strength,
			reason: raw.reason.trim(),
			start: located.start,
			end: located.end,
		});
	}

	const unique = dedupeAnnotations(annotations);
	dropped += annotations.length - unique.length;
	return {
		annotations: unique,
		report: {
			dropped,
			kept: unique.length,
			errors,
			repaired: false,
		},
	};
}

export function dedupeAnnotations(annotations: AlignedAnnotation[]): AlignedAnnotation[] {
	const seen = new Set<string>();
	const unique: AlignedAnnotation[] = [];
	for (const item of annotations) {
		const key = `${item.start}:${item.end}:${item.kind}:${item.patterns.join(",")}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(item);
	}
	return unique.sort((a, b) => a.start - b.start || b.strength - a.strength);
}

export function parseChunkResponse(data: unknown): { ok: true; value: ChunkResponse } | { ok: false; error: string } {
	const parsed = chunkResponseSchema.safeParse(data);
	if (!parsed.success) {
		return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
	}
	return { ok: true, value: parsed.data };
}

export function formatAnnotation(raw: RawAnnotation): string {
	return `${raw.kind} ${raw.patterns.join(",")}`;
}
