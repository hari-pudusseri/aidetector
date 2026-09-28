export type MuseConfig = {
	apiKey: string;
	baseUrl: string;
	model: string;
	reasoningEffort: string;
	timeoutMs: number;
};

type ChatChoice = {
	message?: {
		content?: string | Array<{ text?: string }> | null;
		reasoning_content?: string;
		reasoning?: string;
	};
	finish_reason?: string;
};

type ChatResponse = {
	choices?: ChatChoice[];
	usage?: Record<string, unknown>;
	error?: { message?: string } | string;
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
	if (text) {
		return text;
	}
	const finish = choice.finish_reason ?? data.finish_reason ?? "unknown";
	throw new Error(`The model returned no text (finish_reason=${finish}).`);
}

export async function museComplete(config: MuseConfig, system: string, user: string): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);
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

		const data = (await response.json()) as ChatResponse;
		if (!response.ok) {
			const message =
				typeof data.error === "string"
					? data.error
					: data.error?.message ?? `Muse request failed (${response.status})`;
			throw new Error(message);
		}
		if (data.error) {
			const message = typeof data.error === "string" ? data.error : data.error.message ?? "Muse request failed";
			throw new Error(message);
		}
		if (data.usage) {
			console.log(JSON.stringify({ message: "muse usage", usage: data.usage, model: config.model }));
		}
		return choiceText(data);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`Muse timed out after ${Math.round(config.timeoutMs / 1000)}s.`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
