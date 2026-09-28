import { flattenHighlights, type Highlight } from "@/lib/scan/highlights";
import { PATTERN_LABELS, type PatternCode } from "@/lib/scan/schema";
import type { AlignedAnnotation } from "@/lib/scan/validate";

export type AnalyzedChunk = {
	failed: boolean;
	ranges?: OffsetRange[];
};

export const FINDINGS_SCHEMA_VERSION = "telltale-findings-v2";
export const AUTHORSHIP_DISCLAIMER = "Style patterns alone do not establish authorship.";
export const LEGACY_RESCAN_COPY = "Rescan to view updated findings.";
export const FLAGGED_COVERAGE_TOOLTIP =
	"Percentage of analyzed text highlighted for stylistic patterns. This is not the probability or percentage of AI authorship.";

export type ObservationHeadline = "scanning" | "few" | "some" | "recurring" | "insufficient" | "failed" | "legacy";

export type OffsetRange = { start: number; end: number };

export type ScanFindings = {
	schemaVersion: typeof FINDINGS_SCHEMA_VERSION;
	headline: ObservationHeadline;
	summary: string;
	flaggedCoveragePercent: number | null;
	flaggedPassageCount: number;
	patternTypeCount: number;
	analyzedChars: number;
	documentChars: number;
	analyzedPercent: number;
	incomplete: boolean;
	partial: boolean;
	preliminary: boolean;
	analyzedRanges: OffsetRange[];
};

export type FindingsInput = {
	documentChars: number;
	chunks: AnalyzedChunk[];
	annotations: AlignedAnnotation[];
	preliminary?: boolean;
	scanFailed?: boolean;
};

export const HEADLINE_COPY: Record<ObservationHeadline, string> = {
	scanning: "Scanning for stylistic patterns…",
	few: "Few AI-style patterns detected",
	some: "Some AI-style patterns detected",
	recurring: "Recurring AI-style patterns detected",
	insufficient: "Not enough analyzed text",
	failed: "Scan failed",
	legacy: LEGACY_RESCAN_COPY,
};

/**
 * Observation headline (telltale-findings-v2)
 *
 * Derived only from validated AI-style highlight regions and how they sit
 * across successfully analyzed text. Never from an authorship label, never
 * from AI/Mixed/Human percentages, and never from a model-generated total.
 *
 * States that are not “few/some/recurring”:
 * - scanning: the scan is still running (UI may overlay this even when a
 *   preliminary band is available).
 * - failed: the scan errored, or every chunk failed and nothing was analyzed.
 * - insufficient: the scan finished but analyzed character length is 0.
 * - legacy: exact highlights and analyzed ranges are not both available.
 *
 * Otherwise, using AI-style regions only (counter-signals excluded):
 *   n     = distinct flagged passages after highlight deduplication
 *   density = union(flagged chars) / analyzed chars
 *   span  = (last flagged end − first flagged start) / analyzed chars, else 0
 *
 *   recurring  if n >= 5, or n >= 3 and span >= 0.40, or n >= 2 and density >= 0.12
 *   some       if n >= 2, or n === 1 and density >= 0.05
 *   few        otherwise, including n === 0 after a successful analysis
 */
export function observationHeadline(args: {
	flaggedPassageCount: number;
	flaggedChars: number;
	analyzedChars: number;
	spanChars: number;
}): "few" | "some" | "recurring" {
	const { flaggedPassageCount: n, flaggedChars, analyzedChars, spanChars } = args;
	if (analyzedChars <= 0) return "few";
	const density = flaggedChars / analyzedChars;
	const span = spanChars / analyzedChars;
	if (n >= 5 || (n >= 3 && span >= 0.4) || (n >= 2 && density >= 0.12)) return "recurring";
	if (n >= 2 || (n === 1 && density >= 0.05)) return "some";
	return "few";
}

export function isFindingsV2(value: unknown): value is ScanFindings {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return record.schemaVersion === FINDINGS_SCHEMA_VERSION && Array.isArray(record.analyzedRanges);
}

export function isLegacyScores(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	if (isFindingsV2(value)) return false;
	const record = value as Record<string, unknown>;
	return "aiPercent" in record || "humanPercent" in record || record.heuristic === "telltale-signal-v1";
}

export function clipRangeToWindows(range: OffsetRange, windows: OffsetRange[]): OffsetRange[] {
	const clipped: OffsetRange[] = [];
	for (const window of windows) {
		const start = Math.max(range.start, window.start);
		const end = Math.min(range.end, window.end);
		if (end > start) clipped.push({ start, end });
	}
	return clipped;
}

export function scoreFindings(input: FindingsInput): ScanFindings {
	const analyzedRanges = mergeAnalyzedRanges(input.chunks);
	const analyzedChars = unionRangeLength(analyzedRanges);
	const documentChars = Math.max(0, input.documentChars);
	const succeeded = input.chunks.some((chunk) => !chunk.failed && analyzedRangeOf(chunk).length > 0);
	const failedAny = input.chunks.some((chunk) => chunk.failed);
	const allFailed = input.chunks.length > 0 && input.chunks.every((chunk) => chunk.failed);

	if (input.scanFailed || (allFailed && !succeeded)) {
		return emptyFindings({
			documentChars,
			headline: "failed",
			summary: `The scan could not analyze this draft. ${AUTHORSHIP_DISCLAIMER}`,
			preliminary: Boolean(input.preliminary),
			partial: false,
			incomplete: true,
		});
	}

	if (analyzedChars <= 0) {
		return emptyFindings({
			documentChars,
			headline: "insufficient",
			summary: `Not enough analyzed text to report stylistic findings. ${AUTHORSHIP_DISCLAIMER}`,
			preliminary: Boolean(input.preliminary),
			partial: failedAny,
			incomplete: true,
		});
	}

	const aiHighlights = flattenHighlights(input.annotations).filter((span) => span.kind === "ai_style");
	const flaggedRanges = aiHighlights.flatMap((span) => clipRangeToWindows(span, analyzedRanges));
	const flaggedChars = unionRangeLength(flaggedRanges);
	const flaggedPassages = aiHighlights.filter(
		(span) => clipRangeToWindows(span, analyzedRanges).length > 0,
	);
	const patternCodes = uniqueAiPatterns(flaggedPassages);
	const spanChars = flaggedSpan(flaggedPassages);
	const headline = observationHeadline({
		flaggedPassageCount: flaggedPassages.length,
		flaggedChars,
		analyzedChars,
		spanChars,
	});
	const analyzedPercent = percentOf(analyzedChars, documentChars);
	return {
		schemaVersion: FINDINGS_SCHEMA_VERSION,
		headline,
		summary: observationSummary(flaggedPassages, patternCodes),
		flaggedCoveragePercent: percentOf(flaggedChars, analyzedChars),
		flaggedPassageCount: flaggedPassages.length,
		patternTypeCount: patternCodes.length,
		analyzedChars,
		documentChars,
		analyzedPercent,
		incomplete: analyzedChars < documentChars || failedAny,
		partial: failedAny && succeeded,
		preliminary: Boolean(input.preliminary),
		analyzedRanges,
	};
}

export function presentHeadline(findings: ScanFindings, scanning: boolean, legacy: boolean): string {
	if (legacy) return HEADLINE_COPY.legacy;
	if (scanning) return HEADLINE_COPY.scanning;
	if (findings.headline === "failed") return HEADLINE_COPY.failed;
	if (findings.headline === "insufficient") return HEADLINE_COPY.insufficient;
	return HEADLINE_COPY[findings.headline];
}

export function legacyFindings(documentChars: number): ScanFindings {
	return emptyFindings({
		documentChars,
		headline: "legacy",
		summary: `${LEGACY_RESCAN_COPY} ${AUTHORSHIP_DISCLAIMER}`,
		preliminary: false,
		partial: false,
		incomplete: true,
		coverage: null,
	});
}

function emptyFindings(args: {
	documentChars: number;
	headline: ObservationHeadline;
	summary: string;
	preliminary: boolean;
	partial: boolean;
	incomplete: boolean;
	coverage?: number | null;
}): ScanFindings {
	return {
		schemaVersion: FINDINGS_SCHEMA_VERSION,
		headline: args.headline,
		summary: args.summary,
		flaggedCoveragePercent: args.coverage === undefined ? null : args.coverage,
		flaggedPassageCount: 0,
		patternTypeCount: 0,
		analyzedChars: 0,
		documentChars: args.documentChars,
		analyzedPercent: 0,
		incomplete: args.incomplete,
		partial: args.partial,
		preliminary: args.preliminary,
		analyzedRanges: [],
	};
}

export function unionRangeLength(ranges: OffsetRange[]): number {
	if (ranges.length === 0) return 0;
	const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
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

function mergeAnalyzedRanges(chunks: AnalyzedChunk[]): OffsetRange[] {
	const ranges = chunks.filter((chunk) => !chunk.failed).flatMap((chunk) => analyzedRangeOf(chunk));
	return coalesceRanges(ranges);
}

function analyzedRangeOf(chunk: AnalyzedChunk): OffsetRange[] {
	if (chunk.ranges && chunk.ranges.length > 0) {
		return chunk.ranges.filter((range) => range.end > range.start);
	}
	return [];
}

function coalesceRanges(ranges: OffsetRange[]): OffsetRange[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: OffsetRange[] = [{ ...sorted[0] }];
	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index];
		const last = merged[merged.length - 1];
		if (current.start <= last.end) {
			last.end = Math.max(last.end, current.end);
		} else {
			merged.push({ ...current });
		}
	}
	return merged;
}

function uniqueAiPatterns(passages: Highlight[]): PatternCode[] {
	const codes = new Set<PatternCode>();
	for (const span of passages) {
		for (const code of span.patterns) {
			if (code.startsWith("P")) codes.add(code);
		}
	}
	return [...codes].sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}

function flaggedSpan(passages: Highlight[]): number {
	if (passages.length === 0) return 0;
	let start = passages[0].start;
	let end = passages[0].end;
	for (const span of passages) {
		start = Math.min(start, span.start);
		end = Math.max(end, span.end);
	}
	return Math.max(0, end - start);
}

function observationSummary(passages: Highlight[], patternCodes: PatternCode[]): string {
	if (passages.length === 0) {
		return `No validated AI-style annotations in the analyzed text. ${AUTHORSHIP_DISCLAIMER}`;
	}
	const labels = patternCodes.slice(0, 2).map((code) => (PATTERN_LABELS[code] ?? code).toLowerCase());
	let lead: string;
	if (labels.length === 0) {
		lead = passages.length === 1 ? "A stylistic pattern appears in a flagged passage." : "Stylistic patterns appear in several passages.";
	} else if (labels.length === 1 && passages.length === 1) {
		lead = `${capitalize(labels[0])} appears in a flagged passage.`;
	} else if (labels.length === 1) {
		lead = `${capitalize(labels[0])} appears in several passages.`;
	} else {
		lead = `${capitalize(labels[0])} and ${labels[1]} appear in several passages.`;
	}
	return `${lead} ${AUTHORSHIP_DISCLAIMER}`;
}

function capitalize(value: string): string {
	if (!value) return value;
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function percentOf(part: number, whole: number): number {
	if (whole <= 0) return 0;
	return Math.max(0, Math.min(100, Math.round((part * 100) / whole)));
}
