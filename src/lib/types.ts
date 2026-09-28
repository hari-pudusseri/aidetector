export type SpanLabel = "ai" | "human";

export type DetectionSpan = {
	start: number;
	end: number;
	text: string;
	label: SpanLabel;
	pattern: number | null;
	patternName: string;
	reason: string;
};

export type DetectionResult = {
	text: string;
	aiScore: number;
	humanScore: number;
	summary: string;
	spans: DetectionSpan[];
	provider: string;
	model: string;
};

export type RawSpan = {
	text?: unknown;
	label?: unknown;
	pattern?: unknown;
	pattern_name?: unknown;
	patternName?: unknown;
	reason?: unknown;
};
