import { getScanConfig } from "@/lib/scan/config";
import type { ScanEvent } from "@/lib/scan/events";
import { runScan } from "@/lib/scan/engine";
import { getMuseConfig, getSitePassword } from "@/lib/env";
import { apiGateResponse } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function encodeEvent(event: ScanEvent): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
	const denied = await apiGateResponse(request.headers.get("cookie"), await getSitePassword());
	if (denied) return denied;

	let body: { text?: unknown; scanId?: unknown; retryChunkIds?: unknown };
	try {
		body = (await request.json()) as { text?: unknown; scanId?: unknown; retryChunkIds?: unknown };
	} catch {
		return Response.json({ error: "Expected JSON." }, { status: 400 });
	}

	const text = typeof body.text === "string" ? body.text : "";
	if (!text.trim()) {
		return Response.json({ error: "Paste some prose first." }, { status: 400 });
	}

	const retryChunkIds = Array.isArray(body.retryChunkIds)
		? body.retryChunkIds.filter((value): value is string => typeof value === "string")
		: undefined;

	let muse;
	try {
		muse = await getMuseConfig();
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "Muse is not configured." }, { status: 500 });
	}

	const config = getScanConfig({ timeoutMs: muse.timeoutMs });
	if (text.length > config.maxDocumentChars) {
		return Response.json(
			{ error: `Keep the sample under ${config.maxDocumentChars.toLocaleString()} characters.` },
			{ status: 400 },
		);
	}

	const abort = new AbortController();
	request.signal.addEventListener("abort", () => abort.abort(), { once: true });

	const stream = new ReadableStream({
		async start(controller) {
			try {
				console.log(
					JSON.stringify({
						message: "scan start",
						chars: text.length,
						retry: Boolean(retryChunkIds?.length),
						model: muse.model,
					}),
				);
				for await (const event of runScan({
					text,
					scanId: typeof body.scanId === "string" ? body.scanId : undefined,
					retryChunkIds,
					signal: abort.signal,
					muse,
					config,
				})) {
					controller.enqueue(encodeEvent(event));
					if (event.type === "scan_completed") {
						console.log(
							JSON.stringify({
								message: "scan done",
								headline: event.scores.headline,
								flaggedCoverage: event.scores.flaggedCoveragePercent,
								failed: event.failedChunks.length,
							}),
						);
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : "Scan failed";
				console.error(JSON.stringify({ message: "scan failed", error: message }));
				controller.enqueue(
					encodeEvent({
						type: "scan_error",
						scanId: typeof body.scanId === "string" ? body.scanId : "unknown",
						seq: 0,
						message,
					}),
				);
			} finally {
				controller.close();
			}
		},
		cancel() {
			abort.abort();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}
