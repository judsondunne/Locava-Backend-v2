export const REELS_MVP_FIRESTORE_COLLECTION = "reelsMvp" as const;

export type ReelsMvpPublishStatus =
  | "not_started"
  | "dry_run_ok"
  | "processing"
  | "published"
  | "failed";

export type ReelsMvpPublishMeta = {
  status: ReelsMvpPublishStatus;
  postId?: string | null;
  runId?: string | null;
  dryRunAt?: string | null;
  processingStartedAt?: string | null;
  publishedAt?: string | null;
  error?: string | null;
  mediaManifest?: ReelsMvpMediaManifest | null;
  colorPipelinePreset?: string | null;
  colorPipelineVersion?: number | null;
};

export type ReelsMvpMediaManifest = {
  assetId: string;
  videosLabKeyPrefix: string;
  lastEncodeDiagnosticsJson?: string | null;
  colorPipelinePreset?: string | null;
  colorPipelineVersion?: number | null;
};

export type StagedReelsMvpDoc = {
  id?: string;
  type?: string;
  status?: string;
  reviewState?: string;
  draft?: Record<string, unknown>;
  media?: Record<string, unknown>;
  readySnapshot?: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
  readyCommittedAt?: unknown;
  publish?: ReelsMvpPublishMeta;
  createdByUid?: string;
};
