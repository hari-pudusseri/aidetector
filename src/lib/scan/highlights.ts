import type { AlignedAnnotation } from "@/lib/scan/validate";
import type { AnnotationKind, PatternCode } from "@/lib/scan/schema";
import { PATTERN_LABELS } from "@/lib/scan/schema";

export type Highlight = {
	start: number;
	end: number;
	kind: AnnotationKind;
	patterns: PatternCode[];
	strength: 1 | 2 | 3;
	reason: string;
	quote: string;
	sources: AlignedAnnotation[];
};

function strengthOf(range: AlignedAnnotation[]): 1 | 2 | 3 {
	return range.reduce((max, item) => (item.strength > max ? item.strength : max), 1 as 1 | 2 | 3);
}

function combineReason(items: AlignedAnnotation[]): string {
	const unique = [...new Set(items.map((item) => item.reason.trim()))];
	return unique.join(" ");
}

/**
 * Assign each character to at most one highlight. Overlapping annotations
 * keep the strongest (then earliest) as primary and fold compatible reasons
 * into the tooltip. Short quotes are never expanded to a whole paragraph.
 */
export function flattenHighlights(annotations: AlignedAnnotation[]): Highlight[] {
	if (annotations.length === 0) return [];
	const points = new Set<number>();
	for (const item of annotations) {
		points.add(item.start);
		points.add(item.end);
	}
	const edges = [...points].sort((a, b) => a - b);
	const segments: Highlight[] = [];
	for (let index = 0; index < edges.length - 1; index += 1) {
		const start = edges[index];
		const end = edges[index + 1];
		if (end <= start) continue;
		const covering = annotations.filter((item) => item.start <= start && item.end >= end);
		if (covering.length === 0) continue;
		covering.sort((a, b) => b.strength - a.strength || a.start - b.start || b.end - a.end);
		const primary = covering[0];
		const compatible = covering.filter((item) => item.kind === primary.kind);
		segments.push({
			start,
			end,
			kind: primary.kind,
			patterns: [...new Set(compatible.flatMap((item) => item.patterns))],
			strength: strengthOf(compatible),
			reason: combineReason(compatible),
			quote: primary.quote,
			sources: compatible,
		});
	}
	return mergeAdjacent(segments);
}

function mergeAdjacent(segments: Highlight[]): Highlight[] {
	if (segments.length === 0) return [];
	const merged: Highlight[] = [segments[0]];
	for (let index = 1; index < segments.length; index += 1) {
		const previous = merged[merged.length - 1];
		const current = segments[index];
		if (
			previous.end === current.start &&
			previous.kind === current.kind &&
			previous.reason === current.reason &&
			previous.patterns.join() === current.patterns.join()
		) {
			previous.end = current.end;
			previous.sources = [...previous.sources, ...current.sources];
			continue;
		}
		merged.push(current);
	}
	return merged;
}

export function highlightTitle(highlight: Highlight): string {
	const labels = highlight.patterns.map((code) => `${code} ${PATTERN_LABELS[code] ?? code}`).join(", ");
	const strength = highlight.strength === 1 ? "subtle" : highlight.strength === 2 ? "clear" : "pronounced";
	return `${labels} · ${strength}\n${highlight.reason}\n“${highlight.quote}”`;
}
