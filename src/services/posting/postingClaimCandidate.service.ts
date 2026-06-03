import { fetchUnexploredMapMarkerSummaries } from "../map/unexploredMapMarkers.service.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import {
  bboxAroundPoint,
  buildCaptureDocId,
  HARD_MAX_SPOT_RADIUS_METERS,
  MAX_CANDIDATES_EVALUATED,
  normalizeActivityToken,
  pickBestClaimCandidate,
  scoreClaimCandidate,
  type ClaimMatchCandidate
} from "./postingClaimMatching.js";

type ClaimCandidateCacheEntry = {
  expiresAt: number;
  candidate: ClaimMatchCandidate | null;
};

const CACHE_TTL_MS = 45_000;
const claimCandidateCache = new Map<string, ClaimCandidateCacheEntry>();

function cacheKey(input: {
  lat: number;
  lng: number;
  activities: string[];
  title?: string;
  itemTypes?: "spot" | "route" | "both";
}): string {
  const latKey = input.lat.toFixed(4);
  const lngKey = input.lng.toFixed(4);
  const activitiesKey = [...new Set(input.activities.map(normalizeActivityToken).filter(Boolean))].sort().join(",");
  const titleKey = String(input.title ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 40);
  const typesKey = input.itemTypes ?? "both";
  return `${latKey}|${lngKey}|${activitiesKey}|${titleKey}|${typesKey}`;
}

function parseActivitiesParam(raw?: string[] | string): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value ?? "").trim()).filter(Boolean);
  const text = String(raw ?? "").trim();
  if (!text) return [];
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function filterMarkersByItemTypes(
  markers: Awaited<ReturnType<typeof fetchUnexploredMapMarkerSummaries>>["markers"],
  itemTypes: "spot" | "route" | "both"
) {
  if (itemTypes === "both") return markers;
  if (itemTypes === "spot") return markers.filter((marker) => marker.itemType === "unexploredSpot");
  return markers.filter((marker) => marker.itemType === "unexploredRoute");
}

async function loadCaptureStatuses(
  candidates: ClaimMatchCandidate[]
): Promise<Map<string, { alreadyCaptured: boolean; capturedByUserId: string | null }>> {
  const db = getFirestoreSourceClient();
  const out = new Map<string, { alreadyCaptured: boolean; capturedByUserId: string | null }>();
  if (!db || candidates.length === 0) return out;

  const refs = candidates.slice(0, 8).map((candidate) =>
    db.collection("spotCaptures").doc(buildCaptureDocId(candidate.sourceCollection, candidate.id))
  );
  const docs = await db.getAll(...refs);
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data() as Record<string, unknown> | undefined;
    out.set(doc.id, {
      alreadyCaptured: true,
      capturedByUserId: typeof data?.firstCapturedByUserId === "string" ? data.firstCapturedByUserId : null
    });
  }
  return out;
}

export async function resolvePostingClaimCandidate(input: {
  lat: number;
  lng: number;
  activities?: string[] | string;
  title?: string;
  itemTypes?: "spot" | "route" | "both";
  maxRadiusMeters?: number;
  allowAlreadyCaptured?: boolean;
}): Promise<{
  candidate: ClaimMatchCandidate | null;
  debug?: {
    radiusMeters: number;
    candidatesEvaluated: number;
    tileCount: number;
    noMatchReason?: string;
  };
}> {
  const activities = parseActivitiesParam(input.activities);
  const itemTypes = input.itemTypes ?? "both";
  const key = cacheKey({
    lat: input.lat,
    lng: input.lng,
    activities,
    title: input.title,
    itemTypes
  });
  const cached = claimCandidateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { candidate: cached.candidate };
  }

  const searchRadius = Math.max(
    30,
    Math.min(HARD_MAX_SPOT_RADIUS_METERS, input.maxRadiusMeters ?? HARD_MAX_SPOT_RADIUS_METERS)
  );
  const bbox = bboxAroundPoint(input.lat, input.lng, searchRadius);
  const { markers, tileCount } = await fetchUnexploredMapMarkerSummaries({
    bbox,
    zoom: 14,
    limit: MAX_CANDIDATES_EVALUATED * 2
  });
  const filtered = filterMarkersByItemTypes(markers, itemTypes).slice(0, MAX_CANDIDATES_EVALUATED);

  const preliminary = filtered
    .map((marker) =>
      scoreClaimCandidate({
        marker,
        postLat: input.lat,
        postLng: input.lng,
        postActivities: activities,
        postTitle: input.title
      })
    )
    .filter((row): row is ClaimMatchCandidate => row != null);

  const captureStatuses = await loadCaptureStatuses(preliminary);
  const scored = preliminary.map((candidate) => {
    const captureDocId = buildCaptureDocId(candidate.sourceCollection, candidate.id);
    const status = captureStatuses.get(captureDocId);
    if (!status) return candidate;
    return {
      ...candidate,
      alreadyCaptured: status.alreadyCaptured,
      capturedByUserId: status.capturedByUserId
    };
  });

  const candidate = pickBestClaimCandidate(scored, {
    allowAlreadyCaptured: input.allowAlreadyCaptured === true
  });

  claimCandidateCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    candidate
  });

  if (process.env.NODE_ENV !== "production") {
    console.info("[posting.claim_candidate]", {
      lat: input.lat,
      lng: input.lng,
      radiusMeters: searchRadius,
      candidatesEvaluated: scored.length,
      tileCount,
      selectedId: candidate?.id ?? null,
      noMatchReason: candidate ? undefined : scored.length === 0 ? "no_candidates_in_radius" : "ambiguous_or_low_score"
    });
  }

  return {
    candidate,
    debug: {
      radiusMeters: searchRadius,
      candidatesEvaluated: scored.length,
      tileCount,
      noMatchReason: candidate ? undefined : scored.length === 0 ? "no_candidates_in_radius" : "ambiguous_or_low_score"
    }
  };
}

export function clearPostingClaimCandidateCacheForTests(): void {
  claimCandidateCache.clear();
}
