import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sitePasswordFrom } from "@/lib/gate";
import { museConfigFromEnv, type MuseConfig } from "@/lib/muse";

function processEnv(): Record<string, string | undefined> {
	return {
		MUSE_API_KEY: process.env.MUSE_API_KEY,
		MUSE_BASE_URL: process.env.MUSE_BASE_URL,
		MUSE_MODEL: process.env.MUSE_MODEL,
		MUSE_REASONING_EFFORT: process.env.MUSE_REASONING_EFFORT,
		MUSE_TIMEOUT_MS: process.env.MUSE_TIMEOUT_MS,
	};
}

function stringField(env: object, key: string): string | undefined {
	const value = (env as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function getSitePassword(): Promise<string | undefined> {
	// Middleware can only see process.env (Next `.env.local` in `next dev`).
	// Prefer that so the signed session cookie verifies on /api/detect.
	const fromProcess = sitePasswordFrom(process.env);
	if (fromProcess) return fromProcess;
	try {
		const { env } = await getCloudflareContext({ async: true });
		return stringField(env, "SITE_PASSWORD");
	} catch {
		return undefined;
	}
}

export async function getMuseConfig(): Promise<MuseConfig> {
	try {
		const { env } = await getCloudflareContext({ async: true });
		return museConfigFromEnv({
			MUSE_API_KEY: stringField(env, "MUSE_API_KEY") ?? process.env.MUSE_API_KEY,
			MUSE_BASE_URL: stringField(env, "MUSE_BASE_URL") ?? process.env.MUSE_BASE_URL,
			MUSE_MODEL: stringField(env, "MUSE_MODEL") ?? process.env.MUSE_MODEL,
			MUSE_REASONING_EFFORT: stringField(env, "MUSE_REASONING_EFFORT") ?? process.env.MUSE_REASONING_EFFORT,
			MUSE_TIMEOUT_MS: stringField(env, "MUSE_TIMEOUT_MS") ?? process.env.MUSE_TIMEOUT_MS,
		});
	} catch {
		return museConfigFromEnv(processEnv());
	}
}
