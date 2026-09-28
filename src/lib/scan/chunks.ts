import { estimateTokens } from "@/lib/scan/tokens";
import type { ScanConfig } from "@/lib/scan/config";
import type { Sentence } from "@/lib/scan/sentences";

export type ScanChunk = {
	id: string;
	index: number;
	contextBefore: Sentence[];
	target: Sentence[];
	contextAfter: Sentence[];
};

export function chunkId(index: number): string {
	return `c${String(index).padStart(4, "0")}`;
}

function takeBefore(sentences: Sentence[], firstIndex: number, tokenBudget: number): Sentence[] {
	const taken: Sentence[] = [];
	let tokens = 0;
	for (let index = firstIndex - 1; index >= 0; index -= 1) {
		const sentence = sentences[index];
		const cost = estimateTokens(sentence.text);
		if (taken.length > 0 && tokens + cost > tokenBudget) break;
		taken.unshift(sentence);
		tokens += cost;
		if (tokens >= tokenBudget) break;
	}
	return taken;
}

function takeAfter(sentences: Sentence[], lastIndex: number, tokenBudget: number): Sentence[] {
	const taken: Sentence[] = [];
	let tokens = 0;
	for (let index = lastIndex + 1; index < sentences.length; index += 1) {
		const sentence = sentences[index];
		const cost = estimateTokens(sentence.text);
		if (taken.length > 0 && tokens + cost > tokenBudget) break;
		taken.push(sentence);
		tokens += cost;
		if (tokens >= tokenBudget) break;
	}
	return taken;
}

export function chunkSentences(sentences: Sentence[], config: ScanConfig): ScanChunk[] {
	if (sentences.length === 0) return [];
	const chunks: ScanChunk[] = [];
	let cursor = 0;
	while (cursor < sentences.length) {
		const target: Sentence[] = [];
		let tokens = 0;
		while (cursor < sentences.length) {
			const sentence = sentences[cursor];
			const cost = estimateTokens(sentence.text);
			if (target.length > 0 && tokens + cost > config.targetTokensMax) {
				break;
			}
			target.push(sentence);
			tokens += cost;
			cursor += 1;
			if (tokens >= config.targetTokensMin) {
				const next = sentences[cursor];
				if (!next) break;
				if (tokens + estimateTokens(next.text) > config.targetTokensMax) break;
			}
		}
		const firstIndex = sentences.findIndex((sentence) => sentence.id === target[0].id);
		const lastIndex = sentences.findIndex((sentence) => sentence.id === target[target.length - 1].id);
		chunks.push({
			id: chunkId(chunks.length + 1),
			index: chunks.length,
			contextBefore: takeBefore(sentences, firstIndex, config.contextTokens),
			target,
			contextAfter: takeAfter(sentences, lastIndex, config.contextTokens),
		});
	}
	return chunks;
}

export function chunkPayload(chunk: ScanChunk) {
	const slim = (sentence: Sentence) => ({ id: sentence.id, text: sentence.text });
	return {
		chunk_id: chunk.id,
		context_before: chunk.contextBefore.map(slim),
		target: chunk.target.map(slim),
		context_after: chunk.contextAfter.map(slim),
	};
}

export function targetText(chunk: ScanChunk): string {
	return chunk.target.map((sentence) => sentence.text).join("");
}
