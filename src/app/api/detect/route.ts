import { DETECT_INSTRUCTION, DETECTOR_SYSTEM } from "@/lib/patterns";
import { normalizeDetection, parseJsonObject, prepareSource } from "@/lib/detect";
import { getMuseConfig } from "@/lib/env";
import { museComplete } from "@/lib/muse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as { text?: unknown };
		const text = prepareSource(typeof body.text === "string" ? body.text : "");
		const config = await getMuseConfig();
		const user = `${DETECT_INSTRUCTION}\n---TEXT---\n${text}\n---END---\n`;
		console.log(
			JSON.stringify({
				message: "detect start",
				chars: text.length,
				model: config.model,
			}),
		);
		const raw = await museComplete(config, DETECTOR_SYSTEM, user);
		const payload = parseJsonObject(raw);
		const result = normalizeDetection(text, payload, {
			provider: "muse",
			model: config.model,
		});
		console.log(
			JSON.stringify({
				message: "detect done",
				aiScore: result.aiScore,
				humanScore: result.humanScore,
				spans: result.spans.length,
			}),
		);
		return Response.json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Scan failed";
		console.error(JSON.stringify({ message: "detect failed", error: message }));
		const status = message.includes("Paste some prose") || message.includes("40,000") ? 400 : 502;
		return Response.json({ error: message }, { status });
	}
}
