export function stripWrappingFence(text: string): string {
	const stripped = text.trim();
	const lines = stripped.split(/\r?\n/);
	if (lines.length >= 2 && lines[0].startsWith("```") && lines[lines.length - 1].trim() === "```") {
		return lines.slice(1, -1).join("\n");
	}
	return stripped;
}

export function parseJsonObject(text: string): Record<string, unknown> {
	const stripped = stripWrappingFence(text).trim();
	try {
		const data = JSON.parse(stripped) as unknown;
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			throw new Error("The model did not return a JSON object");
		}
		return data as Record<string, unknown>;
	} catch (error) {
		if (error instanceof SyntaxError) {
			const start = stripped.indexOf("{");
			const end = stripped.lastIndexOf("}");
			if (start < 0 || end <= start) {
				throw new Error("The model did not return JSON");
			}
			const data = JSON.parse(stripped.slice(start, end + 1)) as unknown;
			if (!data || typeof data !== "object" || Array.isArray(data)) {
				throw new Error("The model did not return a JSON object");
			}
			return data as Record<string, unknown>;
		}
		throw error;
	}
}
