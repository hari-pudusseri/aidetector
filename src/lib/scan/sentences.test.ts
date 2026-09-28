import { describe, expect, it } from "vitest";
import { getScanConfig } from "@/lib/scan/config";
import { chunkSentences } from "@/lib/scan/chunks";
import { reconstruct, segmentSentences, splitOversizedRange } from "@/lib/scan/sentences";

const config = getScanConfig();

describe("sentence segmentation", () => {
	it("reconstructs the original document exactly", () => {
		const source = "Hello world.  Next line.\n\nA new paragraph!";
		const sentences = segmentSentences(source);
		expect(reconstruct(sentences)).toBe(source);
		for (const sentence of sentences) {
			expect(source.slice(sentence.start, sentence.end)).toBe(sentence.text);
		}
	});

	it("preserves CRLF and emoji offsets", () => {
		const source = "Ship it 🚢.\r\nNext: café.";
		const sentences = segmentSentences(source);
		expect(reconstruct(sentences)).toBe(source);
		expect(source.slice(sentences[0].start, sentences[0].end)).toContain("🚢");
	});

	it("keeps combining characters with their letters", () => {
		const source = "The naive\u0301 cafe. Another.";
		const sentences = segmentSentences(source);
		expect(reconstruct(sentences)).toBe(source);
		expect(sentences.some((sentence) => sentence.text.includes("\u0301"))).toBe(true);
	});

	it("assigns unique IDs when the same sentence appears twice", () => {
		const source = "This is fine. This is fine.";
		const sentences = segmentSentences(source);
		const ids = sentences.map((sentence) => sentence.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(sentences[0].text.trim()).toBe(sentences[1]?.text.trim());
		expect(sentences[0].start).not.toBe(sentences[1]?.start);
	});

	it("splits oversized sentences without losing text", () => {
		const word = "luminous ";
		const source = `${word.repeat(400)}end.`;
		const ranges = splitOversizedRange(source, 0, source.length, 80);
		expect(ranges.length).toBeGreaterThan(1);
		expect(ranges.map((range) => source.slice(range.start, range.end)).join("")).toBe(source);
		const sentences = segmentSentences(source, 80);
		expect(reconstruct(sentences)).toBe(source);
		expect(sentences.length).toBeGreaterThan(1);
	});
});

describe("chunk targets", () => {
	it("partition the original document without gaps or overlap", () => {
		const source = Array.from({ length: 40 }, (_, index) => `Sentence number ${index + 1} is here.`).join(" ");
		const sentences = segmentSentences(source, 80);
		const chunks = chunkSentences(sentences, { ...config, targetTokensMin: 20, targetTokensMax: 40, contextTokens: 10 });
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.map((chunk) => chunk.target.map((sentence) => sentence.text).join("")).join("")).toBe(
			reconstruct(sentences),
		);
		const ids = chunks.flatMap((chunk) => chunk.target.map((sentence) => sentence.id));
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("lets context overlap while targets stay exclusive", () => {
		const source = "Alpha is first. Bravo is second. Charlie is third. Delta is fourth. Echo is fifth.";
		const sentences = segmentSentences(source, 20);
		const chunks = chunkSentences(sentences, { ...config, targetTokensMin: 8, targetTokensMax: 16, contextTokens: 40 });
		const contextIds = new Set(chunks.flatMap((chunk) => [...chunk.contextBefore, ...chunk.contextAfter].map((item) => item.id)));
		expect(contextIds.size).toBeGreaterThan(0);
		const targetIds = chunks.flatMap((chunk) => chunk.target.map((item) => item.id));
		expect(new Set(targetIds).size).toBe(targetIds.length);
	});
});
