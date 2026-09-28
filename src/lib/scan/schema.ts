import { z } from "zod";

export const AI_PATTERNS = [
	"P1",
	"P2",
	"P3",
	"P4",
	"P5",
	"P6",
	"P7",
	"P8",
	"P9",
	"P10",
	"P11",
	"P12",
	"P13",
	"P14",
	"P15",
	"P16",
] as const;
export const COUNTER_PATTERNS = ["C1", "C2", "C3", "C4"] as const;
export const ALL_PATTERNS = [
	"P1",
	"P2",
	"P3",
	"P4",
	"P5",
	"P6",
	"P7",
	"P8",
	"P9",
	"P10",
	"P11",
	"P12",
	"P13",
	"P14",
	"P15",
	"P16",
	"C1",
	"C2",
	"C3",
	"C4",
] as const;

export type AiPattern = (typeof AI_PATTERNS)[number];
export type CounterPattern = (typeof COUNTER_PATTERNS)[number];
export type PatternCode = (typeof ALL_PATTERNS)[number];
export type AnnotationKind = "ai_style" | "counter_signal";
export type SignalLevel = "none" | "weak" | "mixed" | "strong";

export const PATTERN_LABELS: Record<PatternCode, string> = {
	P1: "Inflated significance",
	P2: "Promotional tone",
	P3: "Empty abstraction",
	P4: "Formulaic contrast",
	P5: "Mechanical organization",
	P6: "Semantic repetition",
	P7: "Generic framing",
	P8: "Register mismatch",
	P9: "Chatbot residue",
	P10: "Unsupported attribution",
	P11: "Conspicuous diction",
	P12: "Over-explanation",
	P13: "Sycophantic tone",
	P14: "Alignment sterilization",
	P15: "Humanizer artifacts",
	P16: "Encyclopedic normalization",
	C1: "Grounded specificity",
	C2: "Developed perspective",
	C3: "Contextual voice",
	C4: "Substantive progression",
};

export const PATTERN_BLURBS: Record<PatternCode, string> = {
	P1: "Unsupported importance, prestige, or sweeping impact claims.",
	P2: "Sales language or praise that substitutes for concrete information.",
	P3: "Vague profundity, generic insights, or conclusions without substance.",
	P4: "Repeated “not just X but Y” constructions or similar rhetorical templates.",
	P5: "Repetitive triplets, symmetrical lists, stock transitions, or paragraph formulas.",
	P6: "Restating the same point without adding information.",
	P7: "Canned introductions, conclusions, universal lessons, or unnecessary recaps.",
	P8: "Abrupt unexplained changes in voice, formality, or audience.",
	P9: "Assistant greetings, prompt references, placeholders, or response-format leftovers.",
	P10: "Vague appeals to experts or research without identifiable support.",
	P11: "Unnatural clusters of grandiose or stock wording. A single word is not enough.",
	P12: "Unnecessary definitions or qualifications that interrupt the passage.",
	P13: "People-pleasing rhetoric, excessive hedging, or overly compliant language.",
	P14: "Chronically neutral prose that stays rigidly safe and lacks idiosyncrasy.",
	P15: "Forced imperfections or jarring synonym swaps that look like obfuscation.",
	P16: "Wikipedia-like formality in casual writing, including stock words like delve.",
	C1: "Relevant concrete details that contribute to the account.",
	C2: "A particular position, tradeoff, or uncertainty explained in context.",
	C3: "Purposeful asides, humor, or rhythm changes that fit the passage.",
	C4: "Reasoning that develops rather than repeating a template.",
};

export const annotationSchema = z.object({
	sentence_id: z.string().min(1),
	quote: z.string().min(1),
	kind: z.enum(["ai_style", "counter_signal"]),
	patterns: z.array(z.enum(ALL_PATTERNS)).min(1).max(6),
	strength: z.union([z.literal(1), z.literal(2), z.literal(3)]),
	reason: z.string().min(1),
});

export const assessmentSchema = z.object({
	signal: z.enum(["none", "weak", "mixed", "strong"]),
	genre: z.string().min(1).max(120),
	note: z.string().min(1).max(400),
});

export const chunkResponseSchema = z.object({
	annotations: z.array(annotationSchema).max(8),
	assessment: assessmentSchema,
});

export const reviewResponseSchema = z.object({
	summary: z.string().min(1).max(600),
	repeated_patterns: z.array(z.enum(ALL_PATTERNS)).max(12),
	structural_notes: z.string().max(400),
	limitations: z.string().min(1).max(400),
});

export type RawAnnotation = z.infer<typeof annotationSchema>;
export type ChunkResponse = z.infer<typeof chunkResponseSchema>;
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
