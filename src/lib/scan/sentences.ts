import { estimateTokens } from "@/lib/scan/tokens";

export type Sentence = {
	id: string;
	start: number;
	end: number;
	text: string;
};

export function sentenceId(index: number): string {
	return `s${String(index).padStart(4, "0")}`;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function canSplitAt(source: string, index: number): boolean {
	if (index <= 0 || index >= source.length) return false;
	if (isHighSurrogate(source.charCodeAt(index - 1)) && isLowSurrogate(source.charCodeAt(index))) {
		return false;
	}
	return true;
}

type Range = { start: number; end: number };

function rangesFromSegmenter(source: string): Range[] {
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
		return [...segmenter.segment(source)].map((part) => ({
			start: part.index,
			end: part.index + part.segment.length,
		}));
	}
	return fallbackSentenceRanges(source);
}

function fallbackSentenceRanges(source: string): Range[] {
	if (!source) return [];
	const ranges: Range[] = [];
	const pattern = /[^.!?…\n]+(?:[.!?…]+["”'’)]*)?(?:\r?\n+|\s+|$)/g;
	let match: RegExpExecArray | null;
	let cursor = 0;
	while ((match = pattern.exec(source))) {
		if (match.index > cursor) {
			ranges.push({ start: cursor, end: match.index });
		}
		ranges.push({ start: match.index, end: match.index + match[0].length });
		cursor = match.index + match[0].length;
	}
	if (cursor < source.length) {
		ranges.push({ start: cursor, end: source.length });
	}
	return ranges;
}

function mergeWhitespaceOnly(source: string, ranges: Range[]): Range[] {
	if (ranges.length === 0) {
		return source ? [{ start: 0, end: source.length }] : [];
	}
	const merged: Range[] = [];
	for (const range of ranges) {
		const text = source.slice(range.start, range.end);
		if (merged.length > 0 && /^\s*$/.test(text)) {
			merged[merged.length - 1].end = range.end;
			continue;
		}
		merged.push({ ...range });
	}
	return merged;
}

function preferredSplit(source: string, start: number, end: number, targetEnd: number): number {
	const windowStart = Math.max(start + 1, targetEnd - 80);
	const windowEnd = Math.min(end - 1, targetEnd + 40);
	const punctuation = [". ", "? ", "! ", ".\n", "?\n", "!\n", "; ", ": ", ", "];
	for (const mark of punctuation) {
		for (let index = Math.min(windowEnd, end - mark.length); index >= windowStart; index -= 1) {
			if (source.startsWith(mark, index) && canSplitAt(source, index + mark.length)) {
				return index + mark.length;
			}
		}
	}
	for (let index = Math.min(targetEnd, end - 1); index > start; index -= 1) {
		if (/\s/.test(source[index - 1] ?? "") && canSplitAt(source, index)) {
			return index;
		}
	}
	let index = Math.min(targetEnd, end - 1);
	while (index > start && !canSplitAt(source, index)) {
		index -= 1;
	}
	return index > start ? index : end;
}

export function splitOversizedRange(source: string, start: number, end: number, maxTokens: number): Range[] {
	const text = source.slice(start, end);
	if (estimateTokens(text) <= maxTokens) {
		return [{ start, end }];
	}
	const maxChars = Math.max(24, Math.floor(maxTokens * 3.2) - 16);
	const ranges: Range[] = [];
	let cursor = start;
	while (cursor < end) {
		if (end - cursor <= maxChars) {
			ranges.push({ start: cursor, end });
			break;
		}
		const split = preferredSplit(source, cursor, end, cursor + maxChars);
		if (split <= cursor) {
			ranges.push({ start: cursor, end });
			break;
		}
		ranges.push({ start: cursor, end: split });
		cursor = split;
	}
	return ranges;
}

export function segmentSentences(source: string, maxTokens = 650): Sentence[] {
	const raw = mergeWhitespaceOnly(source, rangesFromSegmenter(source));
	const ranges: Range[] = [];
	for (const range of raw) {
		ranges.push(...splitOversizedRange(source, range.start, range.end, maxTokens));
	}
	if (ranges.length === 0 && source.length > 0) {
		ranges.push({ start: 0, end: source.length });
	}
	return ranges.map((range, index) => ({
		id: sentenceId(index + 1),
		start: range.start,
		end: range.end,
		text: source.slice(range.start, range.end),
	}));
}

export function reconstruct(sentences: Sentence[]): string {
	return sentences.map((sentence) => sentence.text).join("");
}
