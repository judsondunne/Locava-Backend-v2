export type LegendScopeType =
  | "place"
  | "activity"
  | "placeActivity"
  | "cell"
  | "cellActivity";

export type LegendPlaceType = "state" | "city" | "region" | "campus";

export type LegendGeohashPrecision = 6;

export type LegendScopeId = string;

export type LegendAwardType =
  | "first_finder"
  | "first_activity_finder"
  | "new_leader"
  | "rank_up"
  | "defended_lead"
  | "close_to_leader";

export type LegendEventType = "overtaken" | "at_risk" | "reclaimed";

export type LegendTopUserRow = {
  userId: string;
  count: number;
};

export type LegendScopeDoc = {
  scopeId: LegendScopeId;
  scopeType: LegendScopeType;
  title: string;
  subtitle: string;
  placeType?: LegendPlaceType | null;
  placeId?: string | null;
  activityId?: string | null;
  geohashPrecision?: LegendGeohashPrecision | null;
  geohash?: string | null;
  totalPosts: number;
  leaderUserId: string | null;
  leaderCount: number;
  topUsers: LegendTopUserRow[];
  lastPostId: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type LegendUserStatDoc = {
  scopeId: LegendScopeId;
  userId: string;
  count: number;
  rankSnapshot: number | null;
  isLeader: boolean;
  lastPostId: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type LegendAwardDoc = {
  awardId: string;
  awardType: LegendAwardType;
  scopeId: LegendScopeId;
  scopeType: LegendScopeType;
  title: string;
  subtitle: string;
  postId: string;
  previousRank: number | null;
  newRank: number | null;
  userCount: number;
  leaderCount: number;
  deltaToLeader: number;
  createdAt: unknown;
  seen: boolean;
};

export type LegendEventDoc = {
  eventId: string;
  eventType: LegendEventType;
  scopeId: LegendScopeId;
  scopeType: LegendScopeType;
  scopeTitle: string;
  activityId?: string | null;
  placeType?: LegendPlaceType | null;
  placeId?: string | null;
  geohash?: string | null;
  previousRank: number | null;
  newRank: number | null;
  previousLeaderCount: number;
  newLeaderCount: number;
  viewerCount: number;
  deltaToReclaim: number;
  overtakenByUserId: string | null;
  overtakenByUserSummary?: { userId: string; handle?: string | null; displayName?: string | null; photoUrl?: string | null } | null;
  sourcePostId: string;
  createdAt: unknown;
  seen: boolean;
};

export type LegendPreviewCardType =
  | "possible_first_finder"
  | "possible_first_activity_finder"
  | "close_to_legend"
  | "possible_new_leader";

export type LegendPreviewCard = {
  type: LegendPreviewCardType;
  scopeId: LegendScopeId;
  title: string;
  subtitle: string;
};

export type LegendPostStageStatus = "staged" | "committed" | "cancelled" | "expired";

export type LegendPostStageDoc = {
  stageId: string;
  userId: string;
  status: LegendPostStageStatus;
  derivedScopes: LegendScopeId[];
  previewCards: LegendPreviewCard[];
  createdAt: unknown;
  expiresAt: unknown;
  committedPostId: string | null;
};

export type LegendPostCreatedInput = {
  postId: string;
  userId: string;
  lat?: number | null;
  lng?: number | null;
  geohash?: string | null;
  activities?: string[];
  city?: string | null;
  state?: string | null;
  region?: string | null;
  createdAt?: string | number | Date | null;
};

export type LegendStagePostInput = {
  userId: string;
  lat?: number | null;
  lng?: number | null;
  geohash?: string | null;
  activityIds?: string[];
  city?: string | null;
  state?: string | null;
  region?: string | null;
};

export function clampLegendMaxScopes(value: unknown, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(1, Math.min(n, 12));
}

export function clampLegendMaxActivities(value: unknown, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(1, Math.min(n, 5));
}

export function normalizeLegendActivityId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/\s+/g, "_").slice(0, 128);
}

export function geohash6(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s.length < 6) return null;
  return s.slice(0, 6);
}

export function buildLegendScopeId(parts: string[]): LegendScopeId {
  // scope ids must be stable and firestore-id safe; keep to ascii with ":" separators.
  return parts
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]/g, "_")
    .slice(0, 240);
}

