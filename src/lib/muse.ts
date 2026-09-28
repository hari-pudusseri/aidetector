export type MuseConfig = {
	apiKey: string;
	baseUrl: string;
	model: string;
	reasoningEffort: string;
	timeoutMs: number;
};

export type MuseUsage = {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
};

export type MuseCompletion = {
	text: string;
	usage?: MuseUsage;
};

export type MuseErrorCode = "auth" | "invalid" | "rate_limit" | "network" | "timeout" | "cancelled" | "empty" | "provider";

export class MuseRequestError extends Error {
	code: MuseErrorCode;
	status?: number;
	retryable: boolean;
	retryAfterMs?: number;

	constructor(message: string, options: { code: MuseErrorCode; status?: number; retryable: boolean; retryAfterMs?: number }) {
		super(message);
		this.name = "MuseRequestError";
		this.code = options.code;
		this.status = options.status;
		this.retryable = options.retryable;
		this.retryAfterMs = options.retryAfterMs;
	}
}

type ChatChoice = {
	message?: {
		content?: string | Array<{ text?: string }> | null;
	};
	finish_reason?: string;
};

type ChatResponse = {
	choices?: ChatChoice[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	error?: { message?: string; code?: string; type?: string } | string;
	finish_reason?: string;
};

function readEnv(env: Record<string, string | undefined>, name: string): string | undefined {
	const value = env[name]?.trim();
	return value || undefined;
}

export function museConfigFromEnv(env: Record<string, string | undefined>): MuseConfig {
	const apiKey = readEnv(env, "MUSE_API_KEY");
	if (!apiKey) {
		throw new Error("Set MUSE_API_KEY in .dev.vars (local) or as a Wrangler secret (production).");
	}

	const timeoutRaw = Number.parseInt(readEnv(env, "MUSE_TIMEOUT_MS") ?? "", 10);
	return {
		apiKey,
		baseUrl: (readEnv(env, "MUSE_BASE_URL") ?? "https://api.meta.ai/v1").replace(/\/$/, ""),
		model: readEnv(env, "MUSE_MODEL") ?? "muse-spark-1.3-contributor",
		reasoningEffort: readEnv(env, "MUSE_REASONING_EFFORT") ?? "medium",
		timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 90_000,
	};
}

function choiceText(data: ChatResponse): string {
	const choice = data.choices?.[0] ?? {};
	const content = choice.message?.content;
	let text = "";
	if (typeof content === "string") {
		text = content.trim();
	} else if (Array.isArray(content)) {
		text = content.map((part) => String(part.text ?? "")).join("").trim();
	}
	if (text) return text;
	const finish = choice.finish_reason ?? data.finish_reason ?? "unknown";
	throw new MuseRequestError(`The model returned no text (finish_reason=${finish}).`, {
		code: "empty",
		retryable: false,
	});
}

function classifyHttpError(status: number, message: string, retryAfterMs?: number): MuseRequestError {
	if (status === 401 || status === 403) {
		return new MuseRequestError(message, { code: "auth", status, retryable: false });
	}
	if (status === 429) {
		return new MuseRequestError(message, { code: "rate_limit", status, retryable: true, retryAfterMs });
	}
	if (status === 400 || status === 422) {
		return new MuseRequestError(message, { code: "invalid", status, retryable: false });
	}
	if (status >= 500) {
		return new MuseRequestError(message, { code: "provider", status, retryable: true });
	}
	return new MuseRequestError(message, { code: "provider", status, retryable: status >= 500 });
}

function parseRetryAfter(header: string | null): number | undefined {
	if (!header) return undefined;
	const seconds = Number.parseInt(header, 10);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(header);
	if (Number.isFinite(date)) return Math.max(0, date - Date.now());
	return undefined;
}

export async function museComplete(
	config: MuseConfig,
	system: string,
	user: string,
	options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<MuseCompletion> {
	const timeoutMs = options.timeoutMs ?? config.timeoutMs;
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onAbort);
	const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
	try {
		const response = await fetch(`${config.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: config.model,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				reasoning_effort: config.reasoningEffort,
			}),
			signal: controller.signal,
		});

		let data: ChatResponse = {};
		try {
			data = (await response.json()) as ChatResponse;
		} catch {
			data = {};
		}

		if (!response.ok) {
			const message =
				typeof data.error === "string"
					? data.error
					: data.error?.message ?? `Muse request failed (${response.status})`;
			throw classifyHttpError(response.status, message, parseRetryAfter(response.headers.get("Retry-After")));
		}
		if (data.error) {
			const message = typeof data.error === "string" ? data.error : data.error.message ?? "Muse request failed";
			throw new MuseRequestError(message, { code: "provider", retryable: false });
		}

		const usage: MuseUsage | undefined = data.usage
			? {
					promptTokens: data.usage.prompt_tokens,
					completionTokens: data.usage.completion_tokens,
					totalTokens: data.usage.total_tokens,
				}
			: undefined;
		if (usage) {
			console.log(JSON.stringify({ message: "muse usage", usage, model: config.model }));
		}
		return { text: choiceText(data), usage };
	} catch (error) {
		if (options.signal?.aborted) {
			throw new MuseRequestError("Scan cancelled.", { code: "cancelled", retryable: false });
		}
		if (error instanceof MuseRequestError) throw error;
		if (error instanceof Error && (error.name === "AbortError" || error.message === "timeout")) {
			throw new MuseRequestError(`Muse timed out after ${Math.round(timeoutMs / 1000)}s.`, {
				code: "timeout",
				retryable: true,
			});
		}
		throw new MuseRequestError(error instanceof Error ? error.message : "Network error", {
			code: "network",
			retryable: true,
		});
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

export async function museCompleteWithRetry(
	config: MuseConfig,
	system: string,
	user: string,
	options: { signal?: AbortSignal; timeoutMs?: number; retryLimit: number },
): Promise<MuseCompletion> {
	let lastError: MuseRequestError | undefined;
	for (let attempt = 0; attempt <= options.retryLimit; attempt += 1) {
		try {
			return await museComplete(config, system, user, options);
		} catch (error) {
			if (!(error instanceof MuseRequestError) || !error.retryable || attempt === options.retryLimit) {
				throw error;
			}
			lastError = error;
			const jitter = Math.floor(Math.random() * 250);
			const backoff = error.retryAfterMs ?? Math.min(8_000, 400 * 2 ** attempt) + jitter;
			await sleep(backoff, options.signal);
		}
	}
	throw lastError ?? new MuseRequestError("Muse request failed.", { code: "provider", retryable: false });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new MuseRequestError("Scan cancelled.", { code: "cancelled", retryable: false }));
			return;
		}
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new MuseRequestError("Scan cancelled.", { code: "cancelled", retryable: false }));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
