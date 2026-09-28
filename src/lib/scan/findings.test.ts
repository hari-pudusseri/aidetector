import { describe, expect, it } from "vitest";
import { flattenHighlights } from "@/lib/scan/highlights";
import {
	AUTHORSHIP_DISCLAIMER,
	FINDINGS_SCHEMA_VERSION,
	isFindingsV2,
	isLegacyScores,
	legacyFindings,
	observationHeadline,
	scoreFindings,
	unionRangeLength,
} from "@/lib/scan/findings";
import { scoreDocument, tallyPatterns, type ChunkAssessment } from "@/lib/scan/score";
import type { AlignedAnnotation } from "@/lib/scan/validate";

function annotation(partial: Partial<AlignedAnnotation> & Pick<AlignedAnnotation, "start" | "end" | "kind">): AlignedAnnotation {
	return {
		sentenceId: "s0001",
		chunkId: "c0001",
		quote: "quote",
		patterns: partial.kind === "counter_signal" ? ["C1"] : ["P2"],
		strength: 2,
		reason: "reason",
		...partial,
	};
}

function chunk(partial: Partial<ChunkAssessment> & Pick<ChunkAssessment, "chunkId" | "ranges" | "failed">): ChunkAssessment {
	const analyzedChars = partial.ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
	return {
		signal: "none",
		genre: "prose",
		note: "note",
		analyzedChars: partial.failed ? 0 : analyzedChars,
		...partial,
	};
}

describe("highlight coverage", () => {
	it("does not double-count overlapping ranges", () => {
		expect(
			unionRangeLength([
				{ start: 0, end: 10 },
				{ start: 5, end: 12 },
			]),
		).toBe(12);
	});

	it("places out-of-order annotations by source offset", () => {
		const highlights = flattenHighlights([
			annotation({ start: 20, end: 25, kind: "ai_style", quote: "later" }),
			annotation({ start: 0, end: 4, kind: "ai_style", quote: "early" }),
		]);
		expect(highlights[0].start).toBe(0);
		expect(highlights[highlights.length - 1].end).toBe(25);
	});

	it("keeps a primary highlight and folds overlapping reasons", () => {
		const highlights = flattenHighlights([
			annotation({ start: 0, end: 10, kind: "ai_style", strength: 3, reason: "stronger", quote: "abcdefghij" }),
			annotation({ start: 2, end: 6, kind: "ai_style", strength: 1, reason: "weaker", quote: "cdef" }),
		]);
		expect(highlights.some((item) => item.reason.includes("stronger"))).toBe(true);
		expect(highlights.every((item) => item.end - item.start < 40)).toBe(true);
	});
});

describe("flagged-text findings", () => {
	it("computes coverage from the union of AI-style highlights over analyzed text", () => {
		const scores = scoreDocument(
			100,
			[
				chunk({ chunkId: "c0001", ranges: [{ start: 0, end: 40 }], failed: false }),
				chunk({ chunkId: "c0002", ranges: [{ start: 40, end: 100 }], failed: true }),
			],
			[
				annotation({ start: 0, end: 10, kind: "ai_style" }),
				annotation({ start: 20, end: 40, kind: "counter_signal", patterns: ["C1"] }),
			],
		);
		expect(scores.schemaVersion).toBe(FINDINGS_SCHEMA_VERSION);
		expect(scores.analyzedChars).toBe(40);
		expect(scores.analyzedPercent).toBe(40);
		expect(scores.flaggedCoveragePercent).toBe(25);
		expect(scores.flaggedPassageCount).toBe(1);
		expect(scores.patternTypeCount).toBe(1);
		expect(scores.incomplete).toBe(true);
		expect(scores.partial).toBe(true);
		expect(scores).not.toHaveProperty("aiPercent");
		expect(scores).not.toHaveProperty("humanPercent");
	});

	it("counts overlapping AI-style highlights once", () => {
		const scores = scoreFindings({
			documentChars: 20,
			chunks: [chunk({ chunkId: "c0001", ranges: [{ start: 0, end: 20 }], failed: false })],
			annotations: [
				annotation({ start: 0, end: 10, kind: "ai_style", patterns: ["P4"] }),
				annotation({ start: 5, end: 12, kind: "ai_style", patterns: ["P7"] }),
			],
		});
		expect(scores.flaggedCoveragePercent).toBe(60);
		expect(scores.patternTypeCount).toBe(2);
	});

	it("does not treat counter-signals as flagged text", () => {
		const scores = scoreFindings({
			documentChars: 50,
			chunks: [chunk({ chunkId: "c0001", ranges: [{ start: 0, end: 50 }], failed: false })],
			annotations: [annotation({ start: 0, end: 40, kind: "counter_signal", patterns: ["C1"] })],
		});
		expect(scores.flaggedCoveragePercent).toBe(0);
		expect(scores.flaggedPassageCount).toBe(0);
		expect(scores.headline).toBe("few");
		expect(scores.summary).toContain("No validated AI-style annotations");
		expect(scores.summary).toContain(AUTHORSHIP_DISCLAIMER);
	});

	it("reports zero highlights after a successful analysis as few, not insufficient", () => {
		const scores = scoreFindings({
			documentChars: 30,
			chunks: [chunk({ chunkId: "c0001", ranges: [{ start: 0, end: 30 }], failed: false })],
			annotations: [],
		});
		expect(scores.headline).toBe("few");
		expect(scores.flaggedCoveragePercent).toBe(0);
	});

	it("shows failed and insufficient instead of few when nothing was analyzed", () => {
		expect(
			scoreFindings({
				documentChars: 40,
				chunks: [chunk({ chunkId: "c0001", ranges: [], failed: true })],
				annotations: [],
			}).headline,
		).toBe("failed");
		expect(
			scoreFindings({
				documentChars: 40,
				chunks: [],
				annotations: [],
			}).headline,
		).toBe("insufficient");
	});

	it("excludes highlights that fall outside analyzed ranges", () => {
		const scores = scoreFindings({
			documentChars: 80,
			chunks: [chunk({ chunkId: "c0001", ranges: [{ start: 0, end: 20 }], failed: false })],
			annotations: [annotation({ start: 50, end: 70, kind: "ai_style" })],
		});
		expect(scores.flaggedCoveragePercent).toBe(0);
		expect(scores.flaggedPassageCount).toBe(0);
	});

	it("never relabels a legacy authorship percent as flagged coverage", () => {
		const legacy = { heuristic: "telltale-signal-v1", aiPercent: 71, humanPercent: 22, mixedPercent: 7 };
		expect(isLegacyScores(legacy)).toBe(true);
		expect(isFindingsV2(legacy)).toBe(false);
		const presented = legacyFindings(100);
		expect(presented.headline).toBe("legacy");
		expect(presented.flaggedCoveragePercent).toBeNull();
		expect(presented.summary).toContain("Rescan to view updated findings");
	});
});

describe("observation headline", () => {
	it("does not use an authorship percentage to pick the band", () => {
		expect(
			observationHeadline({ flaggedPassageCount: 0, flaggedChars: 0, analyzedChars: 400, spanChars: 0 }),
		).toBe("few");
		expect(
			observationHeadline({ flaggedPassageCount: 2, flaggedChars: 20, analyzedChars: 400, spanChars: 80 }),
		).toBe("some");
		expect(
			observationHeadline({ flaggedPassageCount: 3, flaggedChars: 30, analyzedChars: 200, spanChars: 120 }),
		).toBe("recurring");
	});
});

describe("pattern tallies", () => {
	it("counts flags across highlights", () => {
		const rows = tallyPatterns([
			annotation({ start: 0, end: 4, kind: "ai_style", patterns: ["P2", "P3"] }),
			annotation({ start: 8, end: 12, kind: "ai_style", patterns: ["P2"] }),
			annotation({ start: 20, end: 24, kind: "counter_signal", patterns: ["C1"] }),
		]);
		expect(rows[0]).toMatchObject({ code: "P2", count: 2, kind: "ai_style" });
		expect(rows.some((row) => row.code === "C1" && row.count === 1 && row.kind === "counter_signal")).toBe(true);
	});
});
