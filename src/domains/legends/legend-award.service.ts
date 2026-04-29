import type {
  LegendAwardDoc,
  LegendAwardType,
  LegendScopeDoc,
  LegendScopeId,
  LegendScopeType,
  LegendTopUserRow
} from "./legends.types.js";

function titleCaseActivity(activityId: string): string {
  const parts = String(activityId ?? "")
    .split("_")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return String(activityId ?? "");
  return parts.map((p) => `${p.slice(0, 1).toUpperCase()}${p.slice(1)}`).join(" ");
}

const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming"
};

function humanizePlace(placeType: string | null, placeId: string | null): string {
  if (!placeId) return placeType ? placeType : "your area";
  if (placeType === "state") {
    const key = placeId.trim().toUpperCase();
    return US_STATE_NAMES[key] ?? placeId;
  }
  return placeId;
}

function parseScopeId(scopeId: LegendScopeId): {
  scopeType: LegendScopeType;
  activityId: string | null;
  placeType: string | null;
  placeId: string | null;
} {
  const parts = String(scopeId ?? "").split(":").map((p) => p.trim());
  const head = parts[0] ?? "";
  if (head === "activity") return { scopeType: "activity", activityId: parts[1] ?? null, placeType: null, placeId: null };
  if (head === "place") return { scopeType: "place", activityId: null, placeType: parts[1] ?? null, placeId: parts[2] ?? null };
  if (head === "placeActivity")
    return { scopeType: "placeActivity", activityId: parts[3] ?? null, placeType: parts[1] ?? null, placeId: parts[2] ?? null };
  if (head === "cellActivity") return { scopeType: "cellActivity", activityId: parts[3] ?? null, placeType: null, placeId: null };
  return { scopeType: head === "cell" ? "cell" : "cell", activityId: null, placeType: null, placeId: null };
}

function buildAwardDisplay(params: {
  awardType: LegendAwardType;
  scopeId: LegendScopeId;
  scopeType: LegendScopeType;
  scopeTitle: string;
  scopeSubtitle: string;
}): { title: string; subtitle: string } {
  const parsed = parseScopeId(params.scopeId);
  const activity = parsed.activityId ? titleCaseActivity(parsed.activityId) : null;
  const place = humanizePlace(parsed.placeType, parsed.placeId);

  if (params.awardType === "first_finder") {
    // Place-based: "First Poster of North Dakota"
    if (params.scopeType === "place" || params.scopeType === "placeActivity") {
      return { title: `First Poster of ${place}`, subtitle: activity ? `${activity} • Territory claimed` : "Territory claimed" };
    }
    return { title: "First Finder", subtitle: params.scopeSubtitle || "Territory claimed" };
  }
  if (params.awardType === "first_activity_finder") {
    // "First Surfer of North Dakota" (or "First Surfer Here" for cellActivity)
    if (activity && (params.scopeType === "placeActivity" || params.scopeType === "place")) {
      return { title: `First ${activity} of ${place}`, subtitle: "You started the map here" };
    }
    if (activity) return { title: `First ${activity} Finder`, subtitle: params.scopeSubtitle || "You started the map here" };
    return { title: "First Activity Finder", subtitle: params.scopeSubtitle || "You started the map here" };
  }
  if (params.awardType === "new_leader") {
    return { title: `New #1: ${params.scopeTitle}`, subtitle: params.scopeSubtitle || "Crown claimed" };
  }
  if (params.awardType === "defended_lead") {
    return { title: `Defended: ${params.scopeTitle}`, subtitle: params.scopeSubtitle || "Still yours" };
  }
  if (params.awardType === "rank_up") {
    return { title: `Rank up: ${params.scopeTitle}`, subtitle: params.scopeSubtitle || "Climbing fast" };
  }
  if (params.awardType === "close_to_leader") {
    return { title: `Almost #1: ${params.scopeTitle}`, subtitle: params.scopeSubtitle || "Within striking distance" };
  }
  return { title: params.scopeTitle, subtitle: params.scopeSubtitle };
}

export function sortTopUsersStable(rows: LegendTopUserRow[]): LegendTopUserRow[] {
  return [...rows].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.userId.localeCompare(b.userId);
  });
}

export function capTopUsers(rows: LegendTopUserRow[], cap: number): LegendTopUserRow[] {
  const bounded = Math.max(1, Math.min(cap, 10));
  return sortTopUsersStable(rows).slice(0, bounded);
}

export function findRank(topUsers: LegendTopUserRow[], userId: string): number | null {
  const idx = topUsers.findIndex((row) => row.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}

function buildAwardId(postId: string, scopeId: LegendScopeId, awardType: LegendAwardType): string {
  return `${postId}_${scopeId}_${awardType}`.slice(0, 240);
}

export class LegendAwardService {
  constructor(
    private readonly config: {
      closeToLeaderThreshold?: number;
    } = {}
  ) {}

  decideAward(params: {
    postId: string;
    scopeId: LegendScopeId;
    scopeType: LegendScopeType;
    scopeWasCreated: boolean;
    prevScope: Pick<LegendScopeDoc, "leaderUserId" | "leaderCount" | "topUsers" | "totalPosts">;
    nextScope: Pick<LegendScopeDoc, "leaderUserId" | "leaderCount" | "topUsers" | "totalPosts" | "title" | "subtitle">;
    userId: string;
    prevUserCount: number;
    nextUserCount: number;
  }): { award: LegendAwardDoc | null; kind: LegendAwardType | null; previousRank: number | null; newRank: number | null } {
    const closeThreshold = Math.max(1, Math.min(this.config.closeToLeaderThreshold ?? 2, 3));

    const prevTop = params.prevScope.topUsers ?? [];
    const nextTop = params.nextScope.topUsers ?? [];
    const previousRank = findRank(prevTop, params.userId);
    const newRank = findRank(nextTop, params.userId);

    const prevLeaderUserId = params.prevScope.leaderUserId;
    const nextLeaderUserId = params.nextScope.leaderUserId;
    const prevLeaderCount = Math.max(0, params.prevScope.leaderCount ?? 0);
    const nextLeaderCount = Math.max(0, params.nextScope.leaderCount ?? 0);

    const deltaToLeader = Math.max(0, nextLeaderCount - params.nextUserCount);

    let awardType: LegendAwardType | null = null;
    if (params.scopeWasCreated) {
      if (params.scopeType === "cell") awardType = "first_finder";
      if (params.scopeType === "cellActivity") awardType = "first_activity_finder";
    }

    if (!awardType) {
      const becameLeader = nextLeaderUserId === params.userId && prevLeaderUserId !== params.userId;
      const defendedLead = nextLeaderUserId === params.userId && prevLeaderUserId === params.userId;
      const improvedRank = previousRank != null && newRank != null && newRank < previousRank;
      const newTopThree = newRank != null && newRank <= 3 && (previousRank == null || previousRank > 3);

      if (becameLeader) {
        awardType = "new_leader";
      } else if (defendedLead && nextLeaderCount > prevLeaderCount) {
        awardType = "defended_lead";
      } else if (improvedRank && newRank !== 1) {
        awardType = "rank_up";
      } else if (newTopThree && newRank !== 1) {
        awardType = "rank_up";
      } else if (deltaToLeader > 0 && deltaToLeader <= closeThreshold) {
        awardType = "close_to_leader";
      }
    }

    if (!awardType) {
      return { award: null, kind: null, previousRank, newRank };
    }

    const award: LegendAwardDoc = {
      awardId: buildAwardId(params.postId, params.scopeId, awardType),
      awardType,
      scopeId: params.scopeId,
      scopeType: params.scopeType,
      ...buildAwardDisplay({
        awardType,
        scopeId: params.scopeId,
        scopeType: params.scopeType,
        scopeTitle: params.nextScope.title,
        scopeSubtitle: params.nextScope.subtitle
      }),
      postId: params.postId,
      previousRank,
      newRank,
      userCount: params.nextUserCount,
      leaderCount: nextLeaderCount,
      deltaToLeader
    } as Omit<LegendAwardDoc, "createdAt" | "seen"> as LegendAwardDoc;

    return { award, kind: awardType, previousRank, newRank };
  }
}

export const legendAwardService = new LegendAwardService();

