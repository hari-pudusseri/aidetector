export const SCAN_PROMPT_VERSION = "telltale-scan-v2";
export const REVIEW_PROMPT_VERSION = "telltale-review-v1";
export const SIGNAL_HEURISTIC_VERSION = "telltale-signal-v1";

/** Muse has no public tokenizer. Conservative estimate: ~3.2 UTF-16 units per token. */
export const ESTIMATED_CHARS_PER_TOKEN = 3.2;
export const TOKEN_ESTIMATE_PADDING = 8;

export type ScanConfig = {
	targetTokensMin: number;
	targetTokensMax: number;
	contextTokens: number;
	concurrency: number;
	timeoutMs: number;
	retryLimit: number;
	maxDocumentChars: number;
	reviewEnabled: boolean;
	reviewInputTokens: number;
	maxAnnotationsPerChunk: number;
	maxReasonChars: number;
	oversizedSentenceTokens: number;
};

const DEFAULTS: ScanConfig = {
	targetTokensMin: 450,
	targetTokensMax: 650,
	contextTokens: 100,
	concurrency: 2,
	timeoutMs: 90_000,
	retryLimit: 2,
	maxDocumentChars: 40_000,
	reviewEnabled: false,
	reviewInputTokens: 800,
	maxAnnotationsPerChunk: 8,
	maxReasonChars: 280,
	oversizedSentenceTokens: 650,
};

function intEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) return fallback;
	if (raw === "1" || raw === "true" || raw === "yes") return true;
	if (raw === "0" || raw === "false" || raw === "no") return false;
	return fallback;
}

export function getScanConfig(overrides: Partial<ScanConfig> = {}): ScanConfig {
	return {
		targetTokensMin: intEnv("SCAN_TARGET_TOKENS_MIN", DEFAULTS.targetTokensMin),
		targetTokensMax: intEnv("SCAN_TARGET_TOKENS_MAX", DEFAULTS.targetTokensMax),
		contextTokens: intEnv("SCAN_CONTEXT_TOKENS", DEFAULTS.contextTokens),
		concurrency: intEnv("SCAN_CONCURRENCY", DEFAULTS.concurrency),
		timeoutMs: intEnv("SCAN_TIMEOUT_MS", DEFAULTS.timeoutMs),
		retryLimit: intEnv("SCAN_RETRY_LIMIT", DEFAULTS.retryLimit),
		maxDocumentChars: intEnv("SCAN_MAX_DOCUMENT_CHARS", DEFAULTS.maxDocumentChars),
		reviewEnabled: boolEnv("SCAN_REVIEW_ENABLED", DEFAULTS.reviewEnabled),
		reviewInputTokens: intEnv("SCAN_REVIEW_INPUT_TOKENS", DEFAULTS.reviewInputTokens),
		maxAnnotationsPerChunk: intEnv("SCAN_MAX_ANNOTATIONS", DEFAULTS.maxAnnotationsPerChunk),
		maxReasonChars: intEnv("SCAN_MAX_REASON_CHARS", DEFAULTS.maxReasonChars),
		oversizedSentenceTokens: intEnv("SCAN_OVERSIZED_SENTENCE_TOKENS", DEFAULTS.oversizedSentenceTokens),
		...overrides,
	};
}

export const MAX_CHARS = DEFAULTS.maxDocumentChars;
