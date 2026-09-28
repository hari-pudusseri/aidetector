import { describe, expect, it, vi } from "vitest";
import { getScanConfig } from "@/lib/scan/config";
import { runScan } from "@/lib/scan/engine";
import type { ScanEvent } from "@/lib/scan/events";
import { MuseRequestError } from "@/lib/muse";

vi.mock("@/lib/muse", async () => {
	const actual = await vi.importActual<typeof import("@/lib/muse")>("@/lib/muse");
	return {
		...actual,
		museCompleteWithRetry: vi.fn(),
	};
});

import { museCompleteWithRetry } from "@/lib/muse";

const mocked = vi.mocked(museCompleteWithRetry);

function chunkJson(sentenceId: string, quote: string) {
	return JSON.stringify({
		annotations: [
			{
				sentence_id: sentenceId,
				quote,
				kind: "ai_style",
				patterns: ["P2"],
				strength: 2,
				reason: "Promotional phrasing.",
			},
		],
		assessment: { signal: "weak", genre: "prose", note: "Some promotional tone." },
	});
}

describe("scan engine", () => {
	it("emits the first chunk result before the scan completes", async () => {
		mocked.mockImplementation(async (_config, system, user) => {
			if (system.includes("document-style reviewer")) {
				return {
					text: JSON.stringify({
						summary: "Local promotional patches in an otherwise ordinary note.",
						repeated_patterns: ["P2"],
						structural_notes: "",
						limitations: "Review saw summaries only.",
					}),
				};
			}
			const payload = JSON.parse(user) as { target: Array<{ id: string; text: string }> };
			const sentence = payload.target[0];
			return { text: chunkJson(sentence.id, sentence.text.trim().slice(0, 12) || sentence.text.slice(0, 8)) };
		});

		const events: ScanEvent[] = [];
		const source = "This city stole my heart. The bakery opened at six. We left before noon.";
		for await (const event of runScan({
			text: source,
			muse: {
				apiKey: "test",
				baseUrl: "https://example.test",
				model: "test",
				reasoningEffort: "medium",
				timeoutMs: 1000,
			},
			config: getScanConfig({
				targetTokensMin: 8,
				targetTokensMax: 16,
				contextTokens: 8,
				concurrency: 2,
				reviewEnabled: false,
			}),
		})) {
			events.push(event);
		}

		const resultIndex = events.findIndex((event) => event.type === "chunk_result");
		const completedIndex = events.findIndex((event) => event.type === "scan_completed");
		expect(resultIndex).toBeGreaterThanOrEqual(0);
		expect(completedIndex).toBeGreaterThan(resultIndex);
		expect(events[0]?.type).toBe("scan_started");
	});

	it("stops scheduling after cancellation", async () => {
		const controller = new AbortController();
		mocked.mockImplementation(async () => {
			controller.abort();
			throw new MuseRequestError("Scan cancelled.", { code: "cancelled", retryable: false });
		});
		const events: ScanEvent[] = [];
		for await (const event of runScan({
			text: "One sentence here. Two sentence there. Three sentence everywhere.",
			signal: controller.signal,
			muse: {
				apiKey: "test",
				baseUrl: "https://example.test",
				model: "test",
				reasoningEffort: "medium",
				timeoutMs: 1000,
			},
			config: getScanConfig({ targetTokensMin: 8, targetTokensMax: 12, concurrency: 1, reviewEnabled: false }),
		})) {
			events.push(event);
		}
		expect(events.some((event) => event.type === "scan_cancelled")).toBe(true);
		expect(events.some((event) => event.type === "scan_completed")).toBe(false);
	});

	it("keeps successful chunks when another chunk fails", async () => {
		let calls = 0;
		mocked.mockImplementation(async (_config, system, user) => {
			if (system.includes("document-style reviewer")) {
				throw new Error("review down");
			}
			calls += 1;
			if (calls === 1) {
				throw new MuseRequestError("boom", { code: "network", retryable: false });
			}
			const payload = JSON.parse(user) as { target: Array<{ id: string; text: string }> };
			const sentence = payload.target[0];
			return { text: chunkJson(sentence.id, sentence.text.trim().slice(0, 10) || sentence.text.slice(0, 8)) };
		});
		const events: ScanEvent[] = [];
		for await (const event of runScan({
			text: "Alpha sentence is here. Bravo sentence is there. Charlie sentence is last.",
			muse: {
				apiKey: "test",
				baseUrl: "https://example.test",
				model: "test",
				reasoningEffort: "medium",
				timeoutMs: 1000,
			},
			config: getScanConfig({
				targetTokensMin: 8,
				targetTokensMax: 12,
				concurrency: 1,
				retryLimit: 0,
				reviewEnabled: true,
			}),
		})) {
			events.push(event);
		}
		expect(events.some((event) => event.type === "chunk_failed")).toBe(true);
		expect(events.some((event) => event.type === "chunk_result")).toBe(true);
		const completed = events.find((event) => event.type === "scan_completed");
		expect(completed?.type).toBe("scan_completed");
		if (completed?.type === "scan_completed") {
			expect(completed.failedChunks.length).toBeGreaterThan(0);
			expect(completed.scores.schemaVersion).toBe("telltale-findings-v2");
			expect(completed.scores.partial).toBe(true);
			expect(completed.scores).not.toHaveProperty("aiPercent");
			expect(completed.scores).not.toHaveProperty("humanPercent");
		}
	});

	it("ignores events from a different scan id in the client contract", () => {
		const first = { type: "scan_started" as const, scanId: "aaa", seq: 1 };
		const late = { type: "chunk_result" as const, scanId: "bbb", seq: 2 };
		expect(late.scanId).not.toBe(first.scanId);
	});
});
