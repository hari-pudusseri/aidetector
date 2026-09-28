import type { DetectionResult, DetectionSpan, RawSpan, SpanLabel } from "@/lib/types";

const MAX_CHARS = 40_000;

export { MAX_CHARS };

function stripWrappingFence(text: string): string {
	const stripped = text.replace(/^\s+|\s+$/g, "");
	const lines = stripped.split(/\r?\n/);
	if (lines.length >= 2 && lines[0].startsWith("```") && lines[lines.length - 1].trim() === "```") {
		return lines.slice(1, -1).join("\n");
	}
	return stripped;
}

export function parseJsonObject(text: string): Record<string, unknown> {
	const stripped = stripWrappingFence(text).trim();
	try {
		const data = JSON.parse(stripped) as unknown;
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			throw new Error("The model did not return a JSON object");
		}
		return data as Record<string, unknown>;
	} catch (error) {
		if (error instanceof SyntaxError) {
			const start = stripped.indexOf("{");
			const end = stripped.lastIndexOf("}");
			if (start < 0 || end <= start) {
				throw new Error("The model did not return JSON");
			}
			const data = JSON.parse(stripped.slice(start, end + 1)) as unknown;
			if (!data || typeof data !== "object" || Array.isArray(data)) {
				throw new Error("The model did not return a JSON object");
			}
			return data as Record<string, unknown>;
		}
		throw error;
	}
}

function clampScore(value: unknown, fallback: number): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) {
		return fallback;
	}
	return Math.max(0, Math.min(100, Math.round(number)));
}

export function locateSpans(source: string, rawSpans: unknown): DetectionSpan[] {
	if (!Array.isArray(rawSpans)) {
		return [];
	}

	const occupied = new Array<boolean>(source.length + 1).fill(false);
	const candidates: Array<{ length: number; start: number; end: number; item: RawSpan }> = [];

	for (const item of rawSpans) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const raw = item as RawSpan;
		const snippet = String(raw.text ?? "");
		if (snippet.length < 8) {
			continue;
		}
		let start = source.indexOf(snippet);
		while (start !== -1) {
			candidates.push({
				length: snippet.length,
				start,
				end: start + snippet.length,
				item: raw,
			});
			start = source.indexOf(snippet, start + 1);
		}
	}

	candidates.sort((a, b) => b.length - a.length || a.start - b.start);
	const located: DetectionSpan[] = [];

	for (const candidate of candidates) {
		let blocked = false;
		for (let index = candidate.start; index < candidate.end; index += 1) {
			if (occupied[index]) {
				blocked = true;
				break;
			}
		}
		if (blocked) {
			continue;
		}
		for (let index = candidate.start; index < candidate.end; index += 1) {
			occupied[index] = true;
		}
		const rawLabel = String(candidate.item.label ?? "ai")
			.trim()
			.toLowerCase();
		const label: SpanLabel = rawLabel === "human" ? "human" : "ai";
		const patternValue = candidate.item.pattern;
		const patternNumber =
			typeof patternValue === "number"
				? patternValue
				: Number.isFinite(Number(patternValue))
					? Number(patternValue)
					: null;
		located.push({
			start: candidate.start,
			end: candidate.end,
			text: source.slice(candidate.start, candidate.end),
			label,
			pattern: patternNumber,
			patternName: String(candidate.item.pattern_name ?? candidate.item.patternName ?? "").trim(),
			reason: String(candidate.item.reason ?? "").trim(),
		});
	}

	located.sort((a, b) => a.start - b.start);
	return located;
}

export function normalizeDetection(
	source: string,
	payload: Record<string, unknown>,
	meta: { provider: string; model: string },
): DetectionResult {
	let aiScore = clampScore(payload.ai_score ?? payload.aiScore, 50);
	let humanScore =
		payload.human_score == null && payload.humanScore == null
			? 100 - aiScore
			: clampScore(payload.human_score ?? payload.humanScore, 100 - aiScore);
	const total = aiScore + humanScore;
	if (total !== 100 && total > 0) {
		aiScore = Math.round((aiScore * 100) / total);
		humanScore = 100 - aiScore;
	}

	return {
		text: source,
		aiScore,
		humanScore,
		summary: String(payload.summary ?? "").trim(),
		spans: locateSpans(source, payload.spans),
		provider: meta.provider,
		model: meta.model,
	};
}

export function prepareSource(source: string): string {
	const text = source.trim();
	if (!text) {
		throw new Error("Paste some prose first.");
	}
	if (text.length > MAX_CHARS) {
		throw new Error("Keep the sample under 40,000 characters.");
	}
	return text;
}
