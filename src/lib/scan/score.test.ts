import { describe, expect, it } from "vitest";
import { flattenHighlights } from "@/lib/scan/highlights";
import { scoreDocument, summarizeSignal, tallyPatterns, unionRangeLength, type ChunkAssessment } from "@/lib/scan/score";
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

describe("signal heuristic", () => {
	it("does not let one strong chunk classify a larger document as strong", () => {
		const chunks: ChunkAssessment[] = [
			{ chunkId: "c0001", signal: "strong", genre: "ad", note: "promo", analyzedChars: 40, failed: false },
			{ chunkId: "c0002", signal: "none", genre: "notes", note: "plain", analyzedChars: 400, failed: false },
			{ chunkId: "c0003", signal: "weak", genre: "notes", note: "mild", analyzedChars: 200, failed: false },
		];
		expect(summarizeSignal(chunks)).not.toBe("strong");
	});

	it("reports AI and human coverage against the full draft", () => {
		const scores = scoreDocument(
			100,
			[
				{ chunkId: "c0001", signal: "weak", genre: "x", note: "x", analyzedChars: 40, failed: false },
				{ chunkId: "c0002", signal: "none", genre: "x", note: "x", analyzedChars: 0, failed: true },
			],
			[
				annotation({ start: 0, end: 10, kind: "ai_style" }),
				annotation({ start: 20, end: 40, kind: "counter_signal", patterns: ["C1"] }),
			],
		);
		expect(scores.coveragePercent).toBe(40);
		expect(scores.aiPercent).toBe(10);
		expect(scores.humanPercent).toBe(20);
		expect(scores.flaggedPercent).toBe(10);
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
