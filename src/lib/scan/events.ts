import type { AlignedAnnotation } from "@/lib/scan/validate";
import type { ChunkAssessment, ScanFindings } from "@/lib/scan/score";
import type { ReviewResponse } from "@/lib/scan/schema";

export type ScanEventType =
	| "scan_started"
	| "chunk_started"
	| "chunk_result"
	| "chunk_failed"
	| "progress"
	| "document_review"
	| "scan_completed"
	| "scan_cancelled"
	| "scan_error";

type BaseEvent = {
	type: ScanEventType;
	scanId: string;
	seq: number;
};

export type ScanStartedEvent = BaseEvent & {
	type: "scan_started";
	chunkCount: number;
	sentenceCount: number;
	promptVersion: string;
	revision: string;
};

export type ChunkStartedEvent = BaseEvent & {
	type: "chunk_started";
	chunkId: string;
	index: number;
	total: number;
};

export type ChunkResultEvent = BaseEvent & {
	type: "chunk_result";
	chunkId: string;
	annotations: AlignedAnnotation[];
	assessment: ChunkAssessment;
	dropped: number;
};

export type ChunkFailedEvent = BaseEvent & {
	type: "chunk_failed";
	chunkId: string;
	message: string;
	retryable: boolean;
};

export type ProgressEvent = BaseEvent & {
	type: "progress";
	completed: number;
	failed: number;
	total: number;
	scores: ScanFindings;
};

export type DocumentReviewEvent = BaseEvent & {
	type: "document_review";
	review: ReviewResponse;
	source: "model" | "local";
};

export type ScanCompletedEvent = BaseEvent & {
	type: "scan_completed";
	scores: ScanFindings;
	summary: string;
	failedChunks: string[];
};

export type ScanCancelledEvent = BaseEvent & {
	type: "scan_cancelled";
	completed: number;
	total: number;
};

export type ScanErrorEvent = BaseEvent & {
	type: "scan_error";
	message: string;
};

export type ScanEvent =
	| ScanStartedEvent
	| ChunkStartedEvent
	| ChunkResultEvent
	| ChunkFailedEvent
	| ProgressEvent
	| DocumentReviewEvent
	| ScanCompletedEvent
	| ScanCancelledEvent
	| ScanErrorEvent;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ScanEventBody = DistributiveOmit<ScanEvent, "scanId" | "seq">;
