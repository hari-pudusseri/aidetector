import { ESTIMATED_CHARS_PER_TOKEN, TOKEN_ESTIMATE_PADDING } from "@/lib/scan/config";

/**
 * Token counts are estimates. Muse does not expose a tokenizer.
 * The 3.2 chars/token ratio plus padding is a conservative safety margin
 * relative to typical ~4 chars/token English averages. A character cap
 * is applied alongside these estimates.
 */
export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN) + TOKEN_ESTIMATE_PADDING;
}

export function estimateTokensMany(texts: string[]): number {
	return texts.reduce((sum, text) => sum + estimateTokens(text), 0);
}
