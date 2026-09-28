"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_CHARS } from "@/lib/scan/config";
import { readScanEvents } from "@/lib/scan/client";
import type { ScanEvent } from "@/lib/scan/events";
import { flattenHighlights, highlightTitle, type Highlight } from "@/lib/scan/highlights";
import { SAMPLE_TEXT } from "@/lib/sample";
import { tallyPatterns, type PatternTally, type ScanFindings } from "@/lib/scan/score";
import {
	AUTHORSHIP_DISCLAIMER,
	FLAGGED_COVERAGE_TOOLTIP,
	HEADLINE_COPY,
	isFindingsV2,
	isLegacyScores,
	legacyFindings,
	presentHeadline,
	scoreFindings,
} from "@/lib/scan/findings";
import { AI_PATTERNS, COUNTER_PATTERNS, PATTERN_BLURBS, PATTERN_LABELS, type PatternCode } from "@/lib/scan/schema";
import type { AlignedAnnotation } from "@/lib/scan/validate";

type ScanStatus = "waiting" | "scanning" | "complete" | "failed" | "cancelled";

type ScanView = {
	status: ScanStatus;
	snapshot: string;
	scanId: string;
	revision: string;
	annotations: AlignedAnnotation[];
	scores: ScanFindings | null;
	completed: number;
	total: number;
	failedChunks: string[];
	message: string;
};

const EMPTY_VIEW: ScanView = {
	status: "waiting",
	snapshot: "",
	scanId: "",
	revision: "",
	annotations: [],
	scores: null,
	completed: 0,
	total: 0,
	failedChunks: [],
	message: "",
};

function wordCount(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/).length;
}

function strengthLabel(strength: 1 | 2 | 3): string {
	return strength === 1 ? "subtle" : strength === 3 ? "pronounced" : "clear";
}

function Gauge({
	percent,
	scanning,
	unavailable,
}: {
	percent: number | null;
	scanning: boolean;
	unavailable: boolean;
}) {
	const size = 108;
	const stroke = 9;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const missing = unavailable || percent === null;
	const clamped = missing ? 0 : Math.max(0, Math.min(100, percent));
	const dash = circumference * (1 - clamped / 100);
	const strokeColor = "var(--ai)";
	return (
		<div className="group relative shrink-0">
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={FLAGGED_COVERAGE_TOOLTIP}>
				<circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(28,23,18,0.08)" strokeWidth={stroke} />
				{missing ? null : (
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill="none"
						stroke={strokeColor}
						strokeWidth={stroke}
						strokeLinecap="round"
						strokeDasharray={circumference}
						strokeDashoffset={dash}
						transform={`rotate(-90 ${size / 2} ${size / 2})`}
						className="transition-[stroke-dashoffset] duration-500"
					/>
				)}
				{scanning ? (
					<g className="gauge-spin" style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}>
						<circle
							cx={size / 2}
							cy={size / 2}
							r={radius}
							fill="none"
							stroke={strokeColor}
							strokeWidth={stroke}
							strokeLinecap="round"
							strokeDasharray={`${circumference * 0.22} ${circumference}`}
							opacity={missing ? 1 : 0.4}
						/>
					</g>
				) : null}
				{missing ? (
					<text
						x="50%"
						y="46%"
						textAnchor="middle"
						dominantBaseline="middle"
						fill="currentColor"
						fontFamily="var(--font-fraunces), Georgia, serif"
						fontSize={scanning ? 30 : 11}
						fontWeight="600"
					>
						{scanning ? "…" : "Unavailable"}
					</text>
				) : (
					<text
						x="50%"
						y="44%"
						textAnchor="middle"
						dominantBaseline="middle"
						fill="currentColor"
						fontFamily="var(--font-fraunces), Georgia, serif"
						fontSize="30"
						fontWeight="600"
					>
						{Math.round(clamped)}
						<tspan fontSize="13" dy="-10">
							%
						</tspan>
					</text>
				)}
				<text x="50%" y="68%" textAnchor="middle" fill={strokeColor} fontSize="8" fontWeight="600" letterSpacing="0.14em">
					FLAGGED TEXT
				</text>
			</svg>
			<span
				role="tooltip"
				className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-30 hidden w-64 -translate-x-1/2 rounded-xl border border-ink/10 bg-card px-3 py-2 text-left text-[12px] leading-5 text-muted shadow-[0_12px_28px_rgba(28,23,18,0.14)] group-hover:block"
			>
				{FLAGGED_COVERAGE_TOOLTIP}
			</span>
		</div>
	);
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<svg className={`animate-spin ${className}`} viewBox="0 0 20 20" fill="none" aria-hidden>
			<circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
			<path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
		</svg>
	);
}

function ScanProgress({ completed, total }: { completed: number; total: number }) {
	const known = total > 0;
	const percent = known ? Math.round((completed / total) * 100) : 0;
	const label = !known
		? "Starting scan…"
		: completed >= total
			? "Finishing…"
			: `Reading passage ${completed + 1} of ${total}`;
	return (
		<div className="mt-4 flex items-center gap-3 rounded-2xl bg-paper/80 px-3 py-2.5" aria-live="polite">
			<Spinner className="h-4 w-4 shrink-0 text-accent" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center justify-between gap-3 text-xs">
					<span className="font-medium text-ink/80">{label}</span>
					<span className="tabular-nums text-muted">{known ? `${completed} / ${total} · ${percent}%` : ""}</span>
				</div>
				<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/10">
					{known ? (
						<span
							className="block h-full rounded-full bg-accent transition-[width] duration-300"
							style={{ width: `${Math.max(percent, 6)}%` }}
						/>
					) : (
						<span className="scan-indeterminate block h-full rounded-full bg-accent" />
					)}
				</div>
			</div>
		</div>
	);
}

function FindingChip({ children }: { children: React.ReactNode }) {
	return (
		<span className="inline-flex items-center rounded-full border border-ink/12 bg-paper/70 px-3.5 py-1.5 text-sm font-medium text-ink/80">
			{children}
		</span>
	);
}

function PatternCell({
	code,
	count,
	tone,
	selected,
	onJump,
}: {
	code: PatternCode;
	count: number;
	tone: "ai" | "human";
	selected: boolean;
	onJump?: (code: PatternCode) => void;
}) {
	const active = count > 0;
	const color =
		tone === "human"
			? active
				? "border-human/45 bg-human-soft text-human"
				: "border-ink/8 text-ink/28"
			: active
				? "border-ai/45 bg-ai-soft text-ai"
				: "border-ink/8 text-ink/28";
	const label = PATTERN_LABELS[code];
	const blurb = PATTERN_BLURBS[code];
	return (
		<span className="group relative">
			<button
				type="button"
				disabled={!active}
				onClick={() => onJump?.(code)}
				aria-label={`${code} ${label}. ${blurb}${active ? ` Seen ${count} time${count === 1 ? "" : "s"}. Click to jump to a matching mark.` : ""}`}
				className={`inline-flex min-w-[2.55rem] items-center justify-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums outline-none disabled:opacity-100 ${
					active ? "cursor-pointer hover:brightness-[0.97]" : "cursor-help"
				} ${color} ${
					selected ? (tone === "human" ? "ring-2 ring-human/55" : "ring-2 ring-ai/55") : ""
				}`}
			>
				{code}
				{active ? <span className="font-sans text-[10px] font-medium opacity-80">×{count}</span> : null}
			</button>
			<span
				role="tooltip"
				className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-30 hidden w-56 -translate-x-1/2 rounded-xl border border-ink/10 bg-card px-3 py-2 text-left shadow-[0_12px_28px_rgba(28,23,18,0.14)] group-hover:block"
			>
				<span className="flex items-baseline gap-1.5">
					<span className={`font-mono text-[11px] font-semibold ${tone === "human" ? "text-human" : "text-ai"}`}>{code}</span>
					<span className="font-display text-sm leading-snug text-ink">{label}</span>
				</span>
				<span className="mt-1 block text-[12px] leading-5 text-muted">{blurb}</span>
				{active ? (
					<span className="mt-1.5 block text-[11px] text-ink/55">
						Seen {count} time{count === 1 ? "" : "s"} · click to jump
						{count > 1 ? " (again for next)" : ""}
					</span>
				) : null}
			</span>
		</span>
	);
}

function PatternKey({
	tallies,
	activeCodes,
	onJump,
}: {
	tallies: PatternTally[];
	activeCodes: PatternCode[];
	onJump: (code: PatternCode) => void;
}) {
	const hits = new Map(tallies.map((row) => [row.code, row.count]));
	return (
		<div className="mt-4">
			<p className="text-[11px] uppercase tracking-[0.16em] text-muted">Patterns</p>
			<div className="mt-2 flex flex-wrap gap-1">
				{AI_PATTERNS.map((code) => (
					<PatternCell
						key={code}
						code={code}
						count={hits.get(code) ?? 0}
						tone="ai"
						selected={activeCodes.includes(code)}
						onJump={onJump}
					/>
				))}
				{COUNTER_PATTERNS.map((code) => (
					<PatternCell
						key={code}
						code={code}
						count={hits.get(code) ?? 0}
						tone="human"
						selected={activeCodes.includes(code)}
						onJump={onJump}
					/>
				))}
			</div>
		</div>
	);
}

function HighlightedText({
	text,
	highlights,
	active,
	onSelect,
}: {
	text: string;
	highlights: Highlight[];
	active: number | null;
	onSelect: (index: number) => void;
}) {
	const nodes: React.ReactNode[] = [];
	let cursor = 0;
	highlights.forEach((span, index) => {
		if (span.start > cursor) {
			nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor, span.start)}</span>);
		}
		const human = span.kind === "counter_signal";
		const selected = active === index;
		nodes.push(
			<mark
				key={`m-${index}`}
				id={`mark-${index}`}
				className={`${human ? "human" : "ai"}${selected ? " is-active" : ""} cursor-pointer`}
				title={highlightTitle(span)}
				onClick={(event) => {
					event.preventDefault();
					onSelect(index);
				}}
			>
				{text.slice(span.start, span.end)}
				<span className={`hl-bubble ${human ? "hl-bubble-human" : "hl-bubble-ai"}`}>{index + 1}</span>
			</mark>,
		);
		cursor = span.end;
	});
	if (cursor < text.length) {
		nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>);
	}
	return <div className="whitespace-pre-wrap break-words">{nodes}</div>;
}

function FlagNote({
	span,
	index,
	selected,
	onToggle,
}: {
	span: Highlight;
	index: number;
	selected: boolean;
	onToggle: () => void;
}) {
	const human = span.kind === "counter_signal";
	const codes = span.patterns.join(" · ");
	const labels = span.patterns.map((code) => PATTERN_LABELS[code] ?? code).join(", ");
	return (
		<li id={`note-${index}`}>
			<button
				type="button"
				aria-expanded={selected}
				onClick={onToggle}
				className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
					selected
						? human
							? "border-human/40 bg-human-soft/70"
							: "border-ai/40 bg-ai-soft/70"
						: "border-ink/8 bg-paper/40 hover:border-ink/16"
				}`}
			>
				<div className="flex items-start gap-2">
					<span className={`hl-bubble mt-0.5 ${human ? "hl-bubble-human" : "hl-bubble-ai"}`}>{index + 1}</span>
					<div className="min-w-0 flex-1">
						<p className="flex min-w-0 items-baseline gap-1.5 text-[11px] tracking-[0.04em]">
							<span className={`font-mono font-semibold ${human ? "text-human" : "text-ai"}`}>{codes}</span>
							<span className="min-w-0 truncate text-muted">
								{labels} · {strengthLabel(span.strength)}
							</span>
						</p>
						{selected ? (
							<>
								<p className="mt-2 font-display text-[15px] leading-snug text-ink/55 italic">“{span.quote}”</p>
								<p className="mt-1 text-sm leading-6 text-ink/80">{span.reason}</p>
							</>
						) : (
							<p className="mt-0.5 truncate text-sm leading-5 text-ink/75">{span.reason}</p>
						)}
					</div>
				</div>
			</button>
		</li>
	);
}

export default function Detector() {
	const [text, setText] = useState("");
	const [scan, setScan] = useState<ScanView>(EMPTY_VIEW);
	const [editing, setEditing] = useState(true);
	const [active, setActive] = useState<number | null>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	const generationRef = useRef(0);

	useEffect(() => {
		return () => abortRef.current?.abort();
	}, []);

	const counts = useMemo(() => ({ words: wordCount(text), chars: text.length }), [text]);
	const highlights = useMemo(() => flattenHighlights(scan.annotations), [scan.annotations]);
	const patternTallies = useMemo(() => tallyPatterns(scan.annotations), [scan.annotations]);
	const findings = useMemo((): ScanFindings | null => {
		if (scan.scores && isFindingsV2(scan.scores)) return scan.scores;
		if (isLegacyScores(scan.scores)) return legacyFindings(scan.snapshot.length);
		if (scan.status === "failed") {
			return scoreFindings({
				documentChars: scan.snapshot.length,
				chunks: [],
				annotations: [],
				scanFailed: true,
			});
		}
		return null;
	}, [scan.scores, scan.snapshot.length, scan.status]);

	const scanning = scan.status === "scanning";
	const showMarks = Boolean(scan.snapshot) && !editing;
	const stale = Boolean(scan.snapshot && text !== scan.snapshot && scan.status !== "waiting");
	const headline = findings
		? presentHeadline(findings, scanning, findings.headline === "legacy")
		: scanning
			? HEADLINE_COPY.scanning
			: scan.status === "failed"
				? HEADLINE_COPY.failed
				: HEADLINE_COPY.insufficient;
	const coverageUnavailable = !findings || findings.headline === "legacy" || findings.flaggedCoveragePercent === null;
	const summaryLead = findings
		? findings.summary.replace(` ${AUTHORSHIP_DISCLAIMER}`, "").replace(AUTHORSHIP_DISCLAIMER, "").trim()
		: "";

	function selectHighlight(index: number) {
		setActive(index);
		const mark = document.getElementById(`mark-${index}`);
		const note = document.getElementById(`note-${index}`);
		mark?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		window.setTimeout(() => note?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 80);
	}

	function toggleFlag(index: number) {
		if (active === index) {
			setActive(null);
			return;
		}
		selectHighlight(index);
	}

	function jumpToPattern(code: PatternCode) {
		const matches = highlights.flatMap((span, index) => (span.patterns.includes(code) ? [index] : []));
		if (matches.length === 0) return;
		const current = active === null ? -1 : matches.indexOf(active);
		const next = matches[(current + 1) % matches.length];
		selectHighlight(next);
	}

	function applyEvent(generation: number, event: ScanEvent) {
		if (generation !== generationRef.current) return;
		setScan((current) => {
			if (current.scanId && event.scanId !== current.scanId && event.type !== "scan_started") {
				return current;
			}
			switch (event.type) {
				case "scan_started":
					return {
						...current,
						status: "scanning",
						scanId: event.scanId,
						revision: event.revision,
						total: event.chunkCount,
						completed: 0,
						failedChunks: [],
						message: "",
					};
				case "chunk_result":
					return {
						...current,
						annotations: [...current.annotations, ...event.annotations],
					};
				case "chunk_failed":
					return {
						...current,
						failedChunks: current.failedChunks.includes(event.chunkId)
							? current.failedChunks
							: [...current.failedChunks, event.chunkId],
					};
				case "progress":
					return {
						...current,
						completed: event.completed,
						total: event.total,
						scores: event.scores,
					};
				case "scan_completed":
					return {
						...current,
						status: event.failedChunks.length && current.annotations.length === 0 ? "failed" : "complete",
						scores: event.scores,
						failedChunks: event.failedChunks,
						completed: event.failedChunks.length ? current.completed : current.total,
						message: event.failedChunks.length
							? `${event.failedChunks.length} passage${event.failedChunks.length === 1 ? "" : "s"} could not be analyzed.`
							: "",
					};
				case "scan_cancelled":
					return {
						...current,
						status: "cancelled",
						message: "Scan stopped. Partial marks are kept.",
					};
				case "scan_error":
					return {
						...current,
						status: "failed",
						message: event.message,
					};
				default:
					return current;
			}
		});
	}

	async function runScan(retryChunkIds?: string[]) {
		const source = retryChunkIds ? scan.snapshot || text : text;
		if (!source.trim()) {
			setScan({ ...EMPTY_VIEW, status: "failed", message: "Paste some prose first." });
			setEditing(true);
			return;
		}
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const generation = generationRef.current + 1;
		generationRef.current = generation;
		setActive(null);
		setEditing(false);
		setScan({
			status: "scanning",
			snapshot: source,
			scanId: retryChunkIds ? scan.scanId : "",
			revision: scan.revision,
			annotations: retryChunkIds ? scan.annotations : [],
			scores: retryChunkIds ? scan.scores : null,
			completed: retryChunkIds ? scan.completed : 0,
			total: retryChunkIds ? scan.total : 0,
			failedChunks: retryChunkIds ? scan.failedChunks : [],
			message: "",
		});
		try {
			const response = await fetch("/api/detect", {
				method: "POST",
				headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
				body: JSON.stringify({
					text: source,
					scanId: retryChunkIds ? scan.scanId : undefined,
					retryChunkIds,
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				const data = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
				throw new Error(data.error || response.statusText);
			}
			await readScanEvents(response, (event) => applyEvent(generation, event), controller.signal);
		} catch (error) {
			if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
				if (generation === generationRef.current) {
					setScan((current) => ({
						...current,
						status: "cancelled",
						message: "Scan stopped. Partial marks are kept.",
					}));
				}
				return;
			}
			if (generation === generationRef.current) {
				setScan((current) => ({
					...current,
					status: "failed",
					message: error instanceof Error ? error.message : "Scan failed",
				}));
			}
		}
	}

	function stopScan() {
		abortRef.current?.abort();
	}

	function loadSample() {
		abortRef.current?.abort();
		generationRef.current += 1;
		setText(SAMPLE_TEXT);
		setScan(EMPTY_VIEW);
		setEditing(true);
		setActive(null);
		editorRef.current?.focus();
	}

	function startEditing() {
		setEditing(true);
		window.setTimeout(() => editorRef.current?.focus(), 0);
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			void runScan();
		}
	}

	return (
		<div className="relative min-h-full">
			<div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
				<header className="flex shrink-0 flex-wrap items-center gap-4 pb-4">
					<div className="flex items-center gap-3">
						<div
							aria-hidden
							className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent shadow-[0_10px_24px_rgba(31,61,52,0.22)]"
						>
							<span className="mr-0.5 h-5 w-2 rounded-sm bg-ai" />
							<span className="h-5 w-2 rounded-sm bg-paper" />
						</div>
						<div>
							<h1 className="font-display text-2xl leading-none italic tracking-tight">Telltale</h1>
							<p className="mt-1 text-sm text-muted">Spot the grain in the writing.</p>
						</div>
					</div>
					<div className="ml-auto flex flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={loadSample}
							className="rounded-full border border-ink/12 bg-card/70 px-4 py-2 text-sm text-ink/80 transition hover:border-ink/25 hover:bg-card"
						>
							Try a sample
						</button>
						{showMarks ? (
							<button
								type="button"
								onClick={startEditing}
								className="rounded-full border border-ink/12 bg-card/70 px-4 py-2 text-sm text-ink/80 transition hover:border-ink/25 hover:bg-card"
							>
								Edit draft
							</button>
						) : null}
						{scanning ? (
							<button
								type="button"
								onClick={stopScan}
								className="inline-flex items-center gap-2 rounded-full border border-ink/12 bg-card px-5 py-2 text-sm font-medium text-ink shadow-[0_10px_20px_rgba(31,61,52,0.08)]"
							>
								<Spinner className="h-3.5 w-3.5 text-accent" />
								Stop
							</button>
						) : (
							<button
								type="button"
								onClick={() => void runScan()}
								className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-paper shadow-[0_10px_20px_rgba(31,61,52,0.2)] transition hover:brightness-110"
							>
								Scan writing
							</button>
						)}
					</div>
				</header>

				<section
					aria-busy={scanning}
					className="flex min-h-[200dvh] flex-1 flex-col overflow-hidden rounded-[28px] border border-ink/8 bg-card shadow-[0_30px_80px_rgba(28,23,18,0.08)]"
				>
					{showMarks || scanning ? (
						<div className="shrink-0 overflow-visible border-b border-ink/8 px-6 py-5">
							<div className="flex flex-wrap items-start gap-5">
								<Gauge
									percent={coverageUnavailable ? null : findings?.flaggedCoveragePercent ?? null}
									scanning={scanning}
									unavailable={coverageUnavailable && !scanning}
								/>
								<div className="min-w-[220px] flex-1">
									<div className="flex flex-wrap items-baseline justify-between gap-2">
										<p className="text-[11px] uppercase tracking-[0.18em] text-muted">Stylistic scan</p>
										<p className="text-xs text-muted">
											{wordCount(scan.snapshot)} words
											{findings?.partial ? " · Partial scan" : ""}
											{scanning || findings?.preliminary ? " · Preliminary" : ""}
										</p>
									</div>
									<p className="mt-2 font-display text-[22px] leading-snug tracking-tight sm:text-[26px]">{headline}</p>
									{summaryLead ? <p className="mt-3 text-sm leading-6 text-ink/80">{summaryLead}</p> : null}
									<p className="mt-1 text-xs leading-5 text-muted">{AUTHORSHIP_DISCLAIMER}</p>
									<p className="mt-4 text-[11px] uppercase tracking-[0.16em] text-muted">Scan findings</p>
									<div className="mt-2 flex flex-wrap gap-2">
										{findings && findings.headline !== "legacy" ? (
											<>
												<FindingChip>
													{findings.flaggedPassageCount} flagged passage{findings.flaggedPassageCount === 1 ? "" : "s"}
												</FindingChip>
												<FindingChip>
													{findings.patternTypeCount} pattern type{findings.patternTypeCount === 1 ? "" : "s"}
												</FindingChip>
												{findings.incomplete ? <FindingChip>{findings.analyzedPercent}% analyzed</FindingChip> : null}
											</>
										) : findings?.headline === "legacy" ? (
											<FindingChip>{HEADLINE_COPY.legacy}</FindingChip>
										) : scanning ? (
											<FindingChip>Preliminary</FindingChip>
										) : null}
									</div>
									<PatternKey
										tallies={patternTallies}
										activeCodes={active === null ? [] : highlights[active]?.patterns ?? []}
										onJump={jumpToPattern}
									/>
									{scanning ? <ScanProgress completed={scan.completed} total={scan.total} /> : null}
								</div>
							</div>
							{stale ? <p className="mt-4 text-sm text-ai">The draft changed. These marks are from an earlier scan.</p> : null}
							{scan.message ? (
								<p className={`mt-4 text-sm ${scan.status === "failed" ? "text-ai" : "text-muted"}`}>{scan.message}</p>
							) : null}
							{scan.failedChunks.length > 0 && scan.status !== "scanning" ? (
								<button
									type="button"
									onClick={() => void runScan(scan.failedChunks)}
									className="mt-3 rounded-full border border-ink/12 bg-card px-4 py-2 text-sm text-ink/80 hover:border-ink/25"
								>
									Retry failed passages
								</button>
							) : null}
						</div>
					) : (
						<div className="flex items-center justify-between border-b border-ink/8 px-6 py-4">
							<div>
								<p className="text-[11px] uppercase tracking-[0.18em] text-muted">Draft</p>
								<p className="mt-1 text-sm text-ink/70">Paste or type. Marks land on this same page.</p>
							</div>
							<p className="text-xs text-muted">
								{counts.words} words · {counts.chars.toLocaleString()} / {MAX_CHARS.toLocaleString()}
							</p>
						</div>
					)}

					<div className="flex min-h-[200dvh] min-w-0 flex-1 flex-row">
						{showMarks ? (
							<>
								<div className="min-h-[200dvh] min-w-0 flex-1 px-6 py-5">
									<HighlightedText text={scan.snapshot} highlights={highlights} active={active} onSelect={selectHighlight} />
								</div>
								<aside className="flex min-h-[200dvh] w-[min(440px,34%)] min-w-[260px] shrink-0 flex-col border-l border-ink/8">
									<div className="px-3 py-4">
										<p className="flex items-center gap-2 px-0.5 text-[11px] uppercase tracking-[0.18em] text-muted">
											Flags
											{scanning ? <Spinner className="h-3 w-3 text-accent" /> : null}
										</p>
										{highlights.length > 0 ? (
											<ol className="mt-3 space-y-1.5">
												{highlights.map((span, index) => (
													<FlagNote
														key={`${span.start}-${index}`}
														span={span}
														index={index}
														selected={active === index}
														onToggle={() => toggleFlag(index)}
													/>
												))}
											</ol>
										) : scanning ? (
											<div className="mt-4 flex items-center gap-2.5 text-sm text-muted">
												<Spinner className="h-4 w-4 shrink-0 text-accent" />
												<span>Marks appear as each passage finishes.</span>
											</div>
										) : (
											<p className="mt-3 font-display text-lg leading-snug text-ink/35 italic">No style flags in this draft.</p>
										)}
									</div>
								</aside>
							</>
						) : (
							<div className="min-h-[200dvh] flex-1 px-6 py-5">
								<textarea
									ref={editorRef}
									value={text}
									onChange={(event) => setText(event.target.value)}
									onKeyDown={onKeyDown}
									placeholder="Paste a paragraph, an email, a blog post, a school essay. Then scan."
									maxLength={MAX_CHARS}
									className="h-full min-h-[200dvh] w-full resize-none bg-transparent font-display text-[18px] leading-[1.7] text-ink outline-none placeholder:text-ink/28"
									aria-label="Writing to scan"
								/>
							</div>
						)}
					</div>

					<p className="flex shrink-0 items-center gap-2 border-t border-ink/8 px-6 py-3 text-xs text-muted">
						{scanning ? (
							<>
								<Spinner className="h-3.5 w-3.5 text-accent" />
								<span>
									{scan.total > 0
										? `Scanning ${scan.completed} of ${scan.total} passages.`
										: "Starting scan…"}
								</span>
							</>
						) : (
							<span>⌘ Enter to scan. Click a numbered bubble or a flag to open its note. Red is AI-style, green is human.</span>
						)}
					</p>
				</section>
			</div>
		</div>
	);
}
