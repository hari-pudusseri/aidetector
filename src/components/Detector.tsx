"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_CHARS } from "@/lib/detect";
import { SAMPLE_TEXT } from "@/lib/sample";
import type { DetectionResult, DetectionSpan } from "@/lib/types";

const SCAN_NOTES = [
	"Listening for stock adjectives…",
	"Looking for human asides…",
	"Checking the rhythm…",
	"Marking the grain…",
];

type ScanState =
	| { status: "idle" }
	| { status: "scanning"; note: string }
	| { status: "done"; result: DetectionResult }
	| { status: "error"; message: string };

function wordCount(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/).length;
}

function HighlightedText({ text, spans }: { text: string; spans: DetectionSpan[] }) {
	const nodes: React.ReactNode[] = [];
	let cursor = 0;
	spans.forEach((span, index) => {
		if (span.start > cursor) {
			nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor, span.start)}</span>);
		}
		nodes.push(
			<mark
				key={`m-${index}`}
				className={span.label}
				title={span.reason || span.patternName}
			>
				{text.slice(span.start, span.end)}
			</mark>,
		);
		cursor = span.end;
	});
	if (cursor < text.length) {
		nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>);
	}
	return <div className="whitespace-pre-wrap break-words">{nodes}</div>;
}

function ScoreCard({
	label,
	value,
	tone,
}: {
	label: string;
	value: number | null;
	tone: "ai" | "human";
}) {
	const color = tone === "ai" ? "text-ai" : "text-human";
	const bar = tone === "ai" ? "bg-ai" : "bg-human";
	return (
		<div className="min-w-0">
			<p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
			<p className={`mt-1 font-display text-5xl leading-none tracking-tight ${color}`}>
				{value == null ? "—" : `${value}`}
				{value != null ? <span className="text-2xl text-ink/30">%</span> : null}
			</p>
			<div className="mt-4 h-1.5 overflow-hidden rounded-full bg-ink/8">
				<span className={`block h-full rounded-full ${bar}`} style={{ width: `${value ?? 0}%` }} />
			</div>
		</div>
	);
}

export default function Detector() {
	const [text, setText] = useState("");
	const [scan, setScan] = useState<ScanState>({ status: "idle" });
	const [noteIndex, setNoteIndex] = useState(0);
	const editorRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (scan.status !== "scanning") return;
		const timer = window.setInterval(() => {
			setNoteIndex((current) => (current + 1) % SCAN_NOTES.length);
		}, 1400);
		return () => window.clearInterval(timer);
	}, [scan.status]);

	const counts = useMemo(
		() => ({ words: wordCount(text), chars: text.trim().length }),
		[text],
	);

	async function runScan() {
		const source = text.trim();
		if (!source) {
			setScan({ status: "error", message: "Paste some prose first." });
			return;
		}
		setScan({ status: "scanning", note: SCAN_NOTES[0] });
		setNoteIndex(0);
		try {
			const response = await fetch("/api/detect", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: source }),
			});
			const data = (await response.json()) as DetectionResult & { error?: string };
			if (!response.ok) {
				throw new Error(data.error || "Scan failed");
			}
			setScan({ status: "done", result: data });
		} catch (error) {
			setScan({
				status: "error",
				message: error instanceof Error ? error.message : "Scan failed",
			});
		}
	}

	function loadSample() {
		setText(SAMPLE_TEXT);
		setScan({ status: "idle" });
		editorRef.current?.focus();
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			void runScan();
		}
	}

	const result = scan.status === "done" ? scan.result : null;
	const scanning = scan.status === "scanning";

	return (
		<div className="relative min-h-full">
			<div className="mx-auto flex min-h-full max-w-[1440px] flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
				<header className="flex flex-wrap items-center gap-4 pb-4">
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
						<button
							type="button"
							onClick={() => void runScan()}
							disabled={scanning}
							className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-paper shadow-[0_10px_20px_rgba(31,61,52,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{scanning ? "Scanning…" : "Scan writing"}
						</button>
					</div>
				</header>

				<main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
					<section className="flex min-h-[520px] flex-col overflow-hidden rounded-[28px] border border-ink/8 bg-card shadow-[0_30px_80px_rgba(28,23,18,0.08)]">
						<div className="flex items-center justify-between border-b border-ink/8 px-6 py-4">
							<div>
								<p className="text-[11px] uppercase tracking-[0.18em] text-muted">Draft</p>
								<p className="mt-1 text-sm text-ink/70">Paste or type. We read the words, not the formatting.</p>
							</div>
							<p className="text-xs text-muted">
								{counts.words} words · {counts.chars.toLocaleString()} / {MAX_CHARS.toLocaleString()}
							</p>
						</div>
						<textarea
							ref={editorRef}
							value={text}
							onChange={(event) => setText(event.target.value)}
							onKeyDown={onKeyDown}
							placeholder="Paste a paragraph, an email, a blog post, a school essay. Then scan."
							maxLength={MAX_CHARS}
							className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-display text-[18px] leading-[1.7] text-ink outline-none placeholder:text-ink/28"
							aria-label="Writing to scan"
						/>
						<p className="border-t border-ink/8 px-6 py-3 text-xs text-muted">
							⌘ Enter to scan. Red marks generated patterns. Green marks lived detail.
						</p>
					</section>

					<section className="flex min-h-[520px] flex-col overflow-hidden rounded-[28px] border border-ink/8 bg-card/80 shadow-[0_30px_80px_rgba(28,23,18,0.08)]">
						<div className="border-b border-ink/8 px-6 py-5">
							<div className="grid grid-cols-2 gap-8">
								<ScoreCard label="AI-like" value={result?.aiScore ?? null} tone="ai" />
								<ScoreCard label="Human-like" value={result?.humanScore ?? null} tone="human" />
							</div>
							{result ? (
								<p className="mt-5 font-display text-lg leading-snug text-ink/80 italic">{result.summary}</p>
							) : scanning ? (
								<p className="mt-5 text-sm text-muted">{SCAN_NOTES[noteIndex]}</p>
							) : scan.status === "error" ? (
								<p className="mt-5 text-sm text-ai">{scan.message}</p>
							) : (
								<p className="mt-5 font-display text-lg leading-snug text-ink/55 italic">
									Good writing has tells. So does generated writing.
								</p>
							)}
						</div>

						<div className="min-h-0 flex-1 overflow-auto px-6 py-5">
							{result ? (
								<>
									<HighlightedText text={result.text} spans={result.spans} />
									{result.spans.length > 0 ? (
										<ul className="mt-8 space-y-3 border-t border-ink/8 pt-5">
											{result.spans.map((span, index) => (
												<li key={`${span.start}-${index}`} className="text-sm leading-6 text-ink/80">
													<span
														className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
															span.label === "human"
																? "bg-human-soft text-human"
																: "bg-ai-soft text-ai"
														}`}
													>
														{span.label}
													</span>
													{span.patternName ? (
														<span className="mr-2 text-muted">
															§{span.pattern} {span.patternName}
														</span>
													) : null}
													<span>{span.reason}</span>
												</li>
											))}
										</ul>
									) : null}
								</>
							) : (
								<div className="flex h-full min-h-[240px] items-center justify-center text-center">
									<p className="max-w-sm font-display text-2xl leading-snug text-ink/35 italic">
										{scanning
											? "Reading the draft like an editor, not a detector dashboard."
											: "The marked draft will land here."}
									</p>
								</div>
							)}
						</div>
					</section>
				</main>
			</div>
		</div>
	);
}
