import type { LocavaInventoryRoute, LocavaInventorySpot } from "../../../../lib/inventory/inventoryLocavaTypes.js";
import type { PbfCopierConfig, PbfCopierRun } from "./pbfCopierTypes.js";

export type DryRunQuotaMap = Record<string, number>;

const QUOTA_KEY_ALIASES: Record<string, string> = {
  hiking_route: "hiking_route",
  hiking_routes: "hiking_route",
  hiking_trail: "hiking_route",
  hiking_trails: "hiking_route",
  trail: "hiking",
  trails: "hiking",
  routes: "route",
  route: "route",
  spots: "spot",
  spot: "spot",
  beaches: "beach",
  beach: "beach",
  waterfall: "waterfall",
  waterfalls: "waterfall",
  peak: "peak",
  peaks: "peak",
  viewpoint: "viewpoint",
  view: "viewpoint",
};

export function normalizeQuotaKey(raw: string): string {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return QUOTA_KEY_ALIASES[key] ?? key;
}

/** Parse one quota fragment like `beach:10`, `10 beaches`, or `5 hiking routes`. */
function parseQuotaPart(part: string): { key: string; target: number } | null {
  const trimmed = part.trim();
  if (!trimmed) return null;

  const colonMatch = trimmed.match(/^([^:=]+)\s*[:=]\s*(\d+)\s*$/);
  if (colonMatch) {
    const key = normalizeQuotaKey(colonMatch[1]!);
    const target = Number(colonMatch[2]);
    if (key && Number.isFinite(target) && target >= 1) {
      return { key, target: Math.floor(target) };
    }
  }

  const countFirstMatch = trimmed.match(/^(\d+)\s+(.+)$/);
  if (countFirstMatch) {
    const key = normalizeQuotaKey(countFirstMatch[2]!);
    const target = Number(countFirstMatch[1]);
    if (key && Number.isFinite(target) && target >= 1) {
      return { key, target: Math.floor(target) };
    }
  }

  return null;
}

/** Pull `20 hiking routes` (and similar) out of free-form text. */
function parseEmbeddedQuotaPhrases(text: string, out: DryRunQuotaMap): void {
  const patterns: Array<{ re: RegExp; key: string }> = [
    { re: /(\d+)\s+hiking\s+routes?\b/gi, key: "hiking_route" },
    { re: /(\d+)\s+hiking\s+trails?\b/gi, key: "hiking_route" },
    { re: /(\d+)\s+beaches?\b/gi, key: "beach" },
    { re: /(\d+)\s+waterfalls?\b/gi, key: "waterfall" },
    { re: /(\d+)\s+viewpoints?\b/gi, key: "viewpoint" },
    { re: /(\d+)\s+peaks?\b/gi, key: "peak" },
    { re: /(\d+)\s+routes?\b/gi, key: "route" },
    { re: /(\d+)\s+spots?\b/gi, key: "spot" },
  ];
  for (const { re, key } of patterns) {
    for (const match of String(text ?? "").matchAll(re)) {
      const target = Number(match[1]);
      if (Number.isFinite(target) && target >= 1) {
        out[key] = (out[key] ?? 0) + Math.floor(target);
      }
    }
  }
}

/** Parse `beach:10`, `5 beaches`, `5 beaches, 3 hiking routes`, or messy free text into a quota map. */
export function parseDryRunQuotaText(text: string): DryRunQuotaMap {
  const out: DryRunQuotaMap = {};
  const raw = String(text ?? "").trim();
  if (!raw) return out;

  for (const part of raw.split(/[,;\n]+|\s+and\s+/i)) {
    const parsed = parseQuotaPart(part);
    if (parsed) {
      out[parsed.key] = (out[parsed.key] ?? 0) + parsed.target;
      continue;
    }
    parseEmbeddedQuotaPhrases(part, out);
  }
  if (Object.keys(out).length === 0) {
    parseEmbeddedQuotaPhrases(raw, out);
  }
  return out;
}

/** When the user entered quota targets, always run in quota stop mode. */
export function resolveDryRunStopMode(input: {
  dryRunStopMode?: PbfCopierConfig["dryRunStopMode"];
  dryRunQuotas?: DryRunQuotaMap;
}): PbfCopierConfig["dryRunStopMode"] {
  if (Object.keys(input.dryRunQuotas ?? {}).length > 0) return "quotas";
  return input.dryRunStopMode === "quotas" ? "quotas" : "max_accepted";
}

/** Preview headroom so quota runs are not capped by the legacy dryRunLimit default. */
export function dryRunPreviewCapFromQuotas(quotas: DryRunQuotaMap, fallbackLimit: number): number {
  const keys = Object.keys(quotas);
  if (keys.length === 0) return fallbackLimit;
  const sum = keys.reduce((total, key) => total + (quotas[key] ?? 0), 0);
  return Math.max(fallbackLimit, sum, Math.ceil(sum * 1.5));
}

export function formatDryRunQuotaText(quotas: DryRunQuotaMap): string {
  return Object.entries(quotas)
    .map(([key, target]) => `${key}:${target}`)
    .join(", ");
}

export function emptyQuotaProgress(quotas: DryRunQuotaMap): DryRunQuotaMap {
  return Object.fromEntries(Object.keys(quotas).map((key) => [key, 0]));
}

export function isQuotaMode(config: PbfCopierConfig): boolean {
  return config.dryRunStopMode === "quotas" && Object.keys(config.dryRunQuotas ?? {}).length > 0;
}

function isHikingTrailRoute(input: {
  primaryCategory?: string | null;
  activities?: string[];
  routeKind?: string | null;
}): boolean {
  const category = (input.primaryCategory ?? "").toLowerCase();
  const activities = (input.activities ?? []).map((a) => a.toLowerCase());
  const routeKind = (input.routeKind ?? "").toLowerCase();
  if (["hiking", "walking", "trail", "path", "track", "running"].includes(category)) return true;
  if (activities.some((a) => ["hiking", "walking", "trail", "running", "mountain"].includes(a))) return true;
  if (/trail|hiking|foot|walking/.test(routeKind)) return true;
  return false;
}

export function matchesQuotaKey(input: {
  primaryCategory?: string | null;
  activities?: string[];
  isRoute?: boolean;
  routeKind?: string | null;
}): (key: string) => boolean {
  const category = (input.primaryCategory ?? "").toLowerCase();
  const activities = (input.activities ?? []).map((a) => a.toLowerCase());
  const isRoute = input.isRoute === true;

  return (rawKey: string) => {
    const key = normalizeQuotaKey(rawKey);
    if (key === "spot") return !isRoute;
    if (key === "route") return isRoute;
    if (key === "hiking_route") {
      return isRoute && isHikingTrailRoute(input);
    }
    if (category === key) return true;
    return activities.includes(key);
  };
}

export function quotaNeedsMoreSpots(quotas: DryRunQuotaMap, progress: DryRunQuotaMap): boolean {
  for (const key of Object.keys(quotas)) {
    if ((progress[key] ?? 0) >= (quotas[key] ?? 0)) continue;
    if (key === "route" || key === "hiking_route") continue;
    return true;
  }
  return false;
}

export function quotaNeedsMoreRoutes(quotas: DryRunQuotaMap, progress: DryRunQuotaMap): boolean {
  for (const key of Object.keys(quotas)) {
    if ((progress[key] ?? 0) >= (quotas[key] ?? 0)) continue;
    if (key === "route" || key === "hiking_route") return true;
  }
  return false;
}

/** Increment only quota keys this item actually satisfies (avoids double-count noise). */
export function incrementMatchingQuotaKeys(input: {
  quotas: DryRunQuotaMap;
  progress: DryRunQuotaMap;
  matcher: (key: string) => boolean;
}): void {
  for (const key of Object.keys(input.quotas)) {
    if (!input.matcher(key)) continue;
    input.progress[key] = (input.progress[key] ?? 0) + 1;
  }
}

export function recordSpotForQuotas(
  spot: Pick<LocavaInventorySpot, "category" | "activities">,
  quotas: DryRunQuotaMap,
  progress: DryRunQuotaMap
): void {
  incrementMatchingQuotaKeys({
    quotas,
    progress,
    matcher: matchesQuotaKey({
      primaryCategory: spot.category,
      activities: spot.activities,
      isRoute: false,
    }),
  });
}

export function recordRouteForQuotas(
  route: Pick<LocavaInventoryRoute, "categories" | "activities" | "activity" | "routeKind">,
  quotas: DryRunQuotaMap,
  progress: DryRunQuotaMap
): void {
  incrementMatchingQuotaKeys({
    quotas,
    progress,
    matcher: matchesQuotaKey({
      primaryCategory: route.categories?.[0] ?? route.activity ?? null,
      activities: route.activities,
      isRoute: true,
      routeKind: route.routeKind,
    }),
  });
}

export function quotasAreMet(quotas: DryRunQuotaMap, progress: DryRunQuotaMap): boolean {
  const keys = Object.keys(quotas);
  if (keys.length === 0) return false;
  return keys.every((key) => (progress[key] ?? 0) >= (quotas[key] ?? 0));
}

export function quotaProgressSummary(quotas: DryRunQuotaMap, progress: DryRunQuotaMap): string {
  return Object.entries(quotas)
    .map(([key, target]) => `${key} ${progress[key] ?? 0}/${target}`)
    .join(", ");
}

export function shouldStopForDryRunQuotas(run: PbfCopierRun, progress: DryRunQuotaMap): boolean {
  if (!isQuotaMode(run.config)) return false;
  return quotasAreMet(run.config.dryRunQuotas ?? {}, progress);
}
