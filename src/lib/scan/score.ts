import { SIGNAL_HEURISTIC_VERSION } from "@/lib/scan/config";
import type { ScanChunk } from "@/lib/scan/chunks";
import { flattenHighlights } from "@/lib/scan/highlights";
import {
	COUNTER_PATTERNS,
	PATTERN_LABELS,
	type AnnotationKind,
	type PatternCode,
	type SignalLevel,
} from "@/lib/scan/schema";
import type { AlignedAnnotation } from "@/lib/scan/validate";

export type ChunkAssessment = {
	chunkId: string;
	signal: SignalLevel;
	genre: string;
	note: string;
	analyzedChars: number;
	failed: boolean;
};

export type DocumentScores = {
	signal: SignalLevel;
	aiPercent: number;
	humanPercent: number;
	flaggedPercent: number;
	observationCount: number;
	analyzedChars: number;
	documentChars: number;
	coveragePercent: number;
	heuristic: typeof SIGNAL_HEURISTIC_VERSION;
};

export type PatternTally = {
	code: PatternCode;
	label: string;
	kind: AnnotationKind;
	count: number;
};

const SIGNAL_RANK: Record<SignalLevel, number> = {
	none: 0,
	weak: 1,
	mixed: 2,
	strong: 3,
};

export function unionRangeLength(ranges: Array<{ start: number; end: number }>): number {
	if (ranges.length === 0) return 0;
	const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
	let total = 0;
	let currentStart = sorted[0].start;
	let currentEnd = sorted[0].end;
	for (let index = 1; index < sorted.length; index += 1) {
		const range = sorted[index];
		if (range.start <= currentEnd) {
			currentEnd = Math.max(currentEnd, range.end);
		} else {
			total += currentEnd - currentStart;
			currentStart = range.start;
			currentEnd = range.end;
		}
	}
	total += currentEnd - currentStart;
	return total;
}

/**
 * UI heuristic (telltale-signal-v1), not a calibrated detector.
 * Weighted average of chunk signals by analyzed characters.
 * A single strong chunk cannot classify a multi-chunk document as strong
 * unless it accounts for at least 40% of analyzed text and the weighted
 * average is already at mixed or higher.
 */
export function summarizeSignal(chunks: ChunkAssessment[]): SignalLevel {
	const usable = chunks.filter((chunk) => !chunk.failed && chunk.analyzedChars > 0);
	if (usable.length === 0) return "none";
	if (usable.length === 1) return usable[0].signal;

	const totalChars = usable.reduce((sum, chunk) => sum + chunk.analyzedChars, 0);
	const weighted =
		usable.reduce((sum, chunk) => sum + SIGNAL_RANK[chunk.signal] * chunk.analyzedChars, 0) / totalChars;

	let signal: SignalLevel = "none";
	if (weighted >= 2.45) signal = "strong";
	else if (weighted >= 1.45) signal = "mixed";
	else if (weighted >= 0.55) signal = "weak";

	if (signal === "strong") {
		const strongChars = usable
			.filter((chunk) => chunk.signal === "strong")
			.reduce((sum, chunk) => sum + chunk.analyzedChars, 0);
		if (strongChars / totalChars < 0.4) {
			signal = "mixed";
		}
	}
	return signal;
}

export function scoreDocument(
	documentChars: number,
	chunks: ChunkAssessment[],
	annotations: AlignedAnnotation[],
): DocumentScores {
	const analyzedChars = chunks.filter((chunk) => !chunk.failed).reduce((sum, chunk) => sum + chunk.analyzedChars, 0);
	const { aiChars, humanChars } = coverageChars(annotations);
	const aiPercent = percentOf(aiChars, documentChars);
	const humanPercent = percentOf(humanChars, documentChars);
	const coveragePercent = percentOf(analyzedChars, documentChars);
	return {
		signal: summarizeSignal(chunks),
		aiPercent,
		humanPercent,
		flaggedPercent: aiPercent,
		observationCount: annotations.length,
		analyzedChars,
		documentChars,
		coveragePercent,
		heuristic: SIGNAL_HEURISTIC_VERSION,
	};
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

export function localSummary(chunks: ChunkAssessment[], scores: DocumentScores): string {
	const notes = chunks
		.filter((chunk) => !chunk.failed && chunk.note)
		.slice(0, 3)
		.map((chunk) => chunk.note);
	const coverage = `${scores.coveragePercent}% of the draft was analyzed.`;
	if (notes.length === 0) {
		return `AI-style signal looks ${scores.signal}. ${coverage}`;
	}
	return `${notes[0]} ${coverage}`;
}

export function chunkChars(chunk: ScanChunk): number {
	return chunk.target.reduce((sum, sentence) => sum + sentence.text.length, 0);
}

function coverageChars(annotations: AlignedAnnotation[]): { aiChars: number; humanChars: number } {
	let aiChars = 0;
	let humanChars = 0;
	for (const span of flattenHighlights(annotations)) {
		const length = span.end - span.start;
		if (span.kind === "counter_signal") humanChars += length;
		else aiChars += length;
	}
	return { aiChars, humanChars };
}

function percentOf(part: number, whole: number): number {
	if (whole <= 0) return 0;
	return Math.max(0, Math.min(100, Math.round((part * 100) / whole)));
}
