export function revisionHash(text: string): string {
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1) {
		hash = Math.imul(hash, 33) ^ text.charCodeAt(index);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function newScanId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `scan-${revisionHash(`${Date.now()}-${Math.random()}`)}`;
}
