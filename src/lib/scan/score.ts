import type { ScanChunk } from "@/lib/scan/chunks";
import {
	COUNTER_PATTERNS,
	PATTERN_LABELS,
	type AnnotationKind,
	type PatternCode,
	type SignalLevel,
} from "@/lib/scan/schema";
import { scoreFindings, type OffsetRange, type ScanFindings } from "@/lib/scan/findings";
import type { AlignedAnnotation } from "@/lib/scan/validate";

export type { ScanFindings } from "@/lib/scan/findings";
export { unionRangeLength } from "@/lib/scan/findings";

export type ChunkAssessment = {
	chunkId: string;
	signal: SignalLevel;
	genre: string;
	note: string;
	analyzedChars: number;
	ranges: OffsetRange[];
	failed: boolean;
};

/** @deprecated Use ScanFindings. Kept as an alias so event payloads share one type. */
export type DocumentScores = ScanFindings;

export type PatternTally = {
	code: PatternCode;
	label: string;
	kind: AnnotationKind;
	count: number;
};

export function scoreDocument(
	documentChars: number,
	chunks: ChunkAssessment[],
	annotations: AlignedAnnotation[],
	options: { preliminary?: boolean; scanFailed?: boolean } = {},
): ScanFindings {
	return scoreFindings({
		documentChars,
		chunks,
		annotations,
		preliminary: options.preliminary,
		scanFailed: options.scanFailed,
	});
}

export function tallyPatterns(annotations: AlignedAnnotation[]): PatternTally[] {
	const counts = new Map<PatternCode, number>();
	for (const item of annotations) {
		for (const code of item.patterns) {
			counts.set(code, (counts.get(code) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([code, count]) => {
			const kind: AnnotationKind = (COUNTER_PATTERNS as readonly PatternCode[]).includes(code)
				? "counter_signal"
				: "ai_style";
			return {
				code,
				label: PATTERN_LABELS[code],
				kind,
				count,
			};
		})
		.sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

export function localSummary(scores: ScanFindings): string {
	return scores.summary;
}

export function chunkChars(chunk: ScanChunk): number {
	return chunk.target.reduce((sum, sentence) => sum + sentence.text.length, 0);
}

export function chunkTargetRanges(chunk: ScanChunk): OffsetRange[] {
	return chunk.target.map((sentence) => ({ start: sentence.start, end: sentence.end }));
}
