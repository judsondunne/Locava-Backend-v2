export type SeedLikesRunMode = "dryRun" | "write";
export type SeedLikesRunScope = "first" | "all";

export type SeedLikesRecentEvent = {
  atMs: number;
  level: "info" | "warn" | "error";
  message: string;
};

import type { SeedLikesConfig } from "./seedLikesConfig.js";

export type SeedLikesRunStatus = {
  runId: string | null;
  mode: SeedLikesRunMode | null;
  scope: SeedLikesRunScope | null;
  activeConfig: SeedLikesConfig | null;
  startedAt: string | null;
  finishedAt: string | null;
  isRunning: boolean;
  stopRequested: boolean;
  scannedPosts: number;
  eligiblePosts: number;
  skippedEnoughLikes: number;
  skippedNoAvailableSeedLikers: number;
  skippedBelowTargetMin: number;
  plannedLikes: number;
  writtenLikes: number;
  failedPosts: number;
  currentPostId: string | null;
  currentPostTitle: string | null;
  currentPostAuthorId: string | null;
  lastUpdatedAt: string | null;
  recentEvents: SeedLikesRecentEvent[];
  lastDryRunPreview: unknown | null;
  errors: string[];
};

const MAX_RECENT_EVENTS = 100;

function emptyStatus(): SeedLikesRunStatus {
  return {
    runId: null,
    mode: null,
    scope: null,
    activeConfig: null,
    startedAt: null,
    finishedAt: null,
    isRunning: false,
    stopRequested: false,
    scannedPosts: 0,
    eligiblePosts: 0,
    skippedEnoughLikes: 0,
    skippedNoAvailableSeedLikers: 0,
    skippedBelowTargetMin: 0,
    plannedLikes: 0,
    writtenLikes: 0,
    failedPosts: 0,
    currentPostId: null,
    currentPostTitle: null,
    currentPostAuthorId: null,
    lastUpdatedAt: null,
    recentEvents: [],
    lastDryRunPreview: null,
    errors: []
  };
}

let status: SeedLikesRunStatus = emptyStatus();

export function getSeedLikesRunStatus(): SeedLikesRunStatus {
  return { ...status, recentEvents: [...status.recentEvents], errors: [...status.errors] };
}

export function resetSeedLikesRunStatus(): void {
  status = emptyStatus();
}

export function beginSeedLikesRun(input: {
  runId: string;
  mode: SeedLikesRunMode;
  scope: SeedLikesRunScope;
  config: SeedLikesConfig;
}): void {
  status = {
    ...emptyStatus(),
    runId: input.runId,
    mode: input.mode,
    scope: input.scope,
    activeConfig: input.config,
    startedAt: new Date().toISOString(),
    isRunning: true,
    lastUpdatedAt: new Date().toISOString()
  };
}

export function finishSeedLikesRun(): void {
  status.isRunning = false;
  status.finishedAt = new Date().toISOString();
  status.lastUpdatedAt = status.finishedAt;
  status.currentPostId = null;
  status.currentPostTitle = null;
  status.currentPostAuthorId = null;
}

export function requestSeedLikesStop(): void {
  status.stopRequested = true;
  status.lastUpdatedAt = new Date().toISOString();
  pushSeedLikesEvent("warn", "Stop requested");
}

export function shouldStopSeedLikesRun(): boolean {
  return status.stopRequested;
}

export function pushSeedLikesEvent(level: SeedLikesRecentEvent["level"], message: string): void {
  const row: SeedLikesRecentEvent = { atMs: Date.now(), level, message };
  status.recentEvents = [row, ...status.recentEvents].slice(0, MAX_RECENT_EVENTS);
  status.lastUpdatedAt = new Date().toISOString();
  if (level === "error") {
    status.errors = [message, ...status.errors].slice(0, MAX_RECENT_EVENTS);
  }
}

export function setSeedLikesCurrentPost(input: {
  postId: string | null;
  title: string | null;
  authorId: string | null;
}): void {
  status.currentPostId = input.postId;
  status.currentPostTitle = input.title;
  status.currentPostAuthorId = input.authorId;
  status.lastUpdatedAt = new Date().toISOString();
}

export function incrementSeedLikesCounters(input: Partial<Pick<SeedLikesRunStatus,
  | "scannedPosts"
  | "eligiblePosts"
  | "skippedEnoughLikes"
  | "skippedNoAvailableSeedLikers"
  | "skippedBelowTargetMin"
  | "plannedLikes"
  | "writtenLikes"
  | "failedPosts"
>>): void {
  if (input.scannedPosts) status.scannedPosts += input.scannedPosts;
  if (input.eligiblePosts) status.eligiblePosts += input.eligiblePosts;
  if (input.skippedEnoughLikes) status.skippedEnoughLikes += input.skippedEnoughLikes;
  if (input.skippedNoAvailableSeedLikers) status.skippedNoAvailableSeedLikers += input.skippedNoAvailableSeedLikers;
  if (input.skippedBelowTargetMin) status.skippedBelowTargetMin += input.skippedBelowTargetMin;
  if (input.plannedLikes) status.plannedLikes += input.plannedLikes;
  if (input.writtenLikes) status.writtenLikes += input.writtenLikes;
  if (input.failedPosts) status.failedPosts += input.failedPosts;
  status.lastUpdatedAt = new Date().toISOString();
}

export function setSeedLikesDryRunPreview(preview: unknown): void {
  status.lastDryRunPreview = preview;
  status.lastUpdatedAt = new Date().toISOString();
}
