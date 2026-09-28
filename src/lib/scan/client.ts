import type { ScanEvent } from "@/lib/scan/events";

export async function readScanEvents(
	response: Response,
	onEvent: (event: ScanEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	if (!response.body) {
		throw new Error("The scan stream was empty.");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const abort = () => {
		void reader.cancel();
	};
	signal?.addEventListener("abort", abort, { once: true });

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split("\n\n");
			buffer = parts.pop() ?? "";
			for (const part of parts) {
				const dataLine = part
					.split("\n")
					.map((line) => line.trim())
					.find((line) => line.startsWith("data:"));
				if (!dataLine) continue;
				const payload = dataLine.slice(5).trim();
				if (!payload) continue;
				onEvent(JSON.parse(payload) as ScanEvent);
			}
		}
		if (buffer.trim()) {
			const dataLine = buffer
				.split("\n")
				.map((line) => line.trim())
				.find((line) => line.startsWith("data:"));
			if (dataLine) {
				onEvent(JSON.parse(dataLine.slice(5).trim()) as ScanEvent);
			}
		}
	} finally {
		signal?.removeEventListener("abort", abort);
	}
}
