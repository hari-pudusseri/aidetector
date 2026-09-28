import { estimateTokens } from "@/lib/scan/tokens";
import type { ChunkAssessment } from "@/lib/scan/score";
import type { PatternCode } from "@/lib/scan/schema";
import type { AlignedAnnotation } from "@/lib/scan/validate";

export type ChunkSummary = {
	chunk_id: string;
	signal: ChunkAssessment["signal"];
	genre: string;
	note: string;
	pattern_counts: Partial<Record<PatternCode, number>>;
	analyzed_chars: number;
};

export function summarizeChunks(
	assessments: ChunkAssessment[],
	annotations: AlignedAnnotation[],
	tokenBudget: number,
): ChunkSummary[] {
	const byChunk = new Map<string, PatternCode[]>();
	for (const annotation of annotations) {
		const list = byChunk.get(annotation.chunkId) ?? [];
		list.push(...annotation.patterns);
		byChunk.set(annotation.chunkId, list);
	}

	const summaries = assessments
		.filter((item) => !item.failed)
		.map((item) => {
			const counts: Partial<Record<PatternCode, number>> = {};
			for (const code of byChunk.get(item.chunkId) ?? []) {
				counts[code] = (counts[code] ?? 0) + 1;
			}
			return {
				chunk_id: item.chunkId,
				signal: item.signal,
				genre: item.genre,
				note: item.note.slice(0, 160),
				pattern_counts: counts,
				analyzed_chars: item.analyzedChars,
			};
		});

	const packed: ChunkSummary[] = [];
	let tokens = 0;
	for (const summary of summaries) {
		const cost = estimateTokens(JSON.stringify(summary));
		if (packed.length > 0 && tokens + cost > tokenBudget) break;
		packed.push(summary);
		tokens += cost;
	}
	return packed;
}
