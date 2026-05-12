/**
 * REIMPLEMENTED AFTER FIRESTORE READ CONTAINMENT: request-scoped near-me candidate loading.
 * Do not restore startup pool warmers or LIMIT 5000 scans.
 */
import type { Firestore } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { NEAR_ME_COLD_MAX_DOCS } from "../../constants/firestore-read-budgets.js";
import { geoPrefixesAroundCenter } from "../../lib/geo-prefixes-around-center.js";
import { getPostCoordinates } from "../../lib/posts/postFieldSelectors.js";

export type NearMePostLike = Record<string, unknown> & { id: string };

export type BoundedNearMeDebug = {
  querySource: "bounded_near_me_v2";
  readBudgetUsed: number;
  readBudgetMax: number;
  cacheHit: boolean;
  candidateCount: number;
  radiusPhases: string[];
};

function roundCoord(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isVisibleNearMePost(post: NearMePostLike): boolean {
  if (post.deleted === true || post.isDeleted === true || post.archived === true || post.hidden === true) return false;
  const privacy = String(post.privacy ?? post.visibility ?? "public").toLowerCase();
  if (privacy === "private" || privacy === "followers") return false;
  const status = String(post.status ?? "active").toLowerCase();
  return status !== "deleted" && status !== "archived";
}

async function queryGeohashPrefixDocs(db: Firestore, prefix: string, maxDocs: number): Promise<NearMePostLike[]> {
  const start = prefix;
  const end = `${prefix}\uf8ff`;
  const cap = Math.max(1, Math.min(40, maxDocs));
  incrementDbOps("queries", 1);
  const snap = await db
    .collection("posts")
    .where("geohash", ">=", start)
    .where("geohash", "<=", end)
    .orderBy("geohash", "asc")
    .limit(cap)
    .get();
  incrementDbOps("reads", snap.docs.length);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

async function queryRecentTimeDesc(db: Firestore, maxDocs: number): Promise<NearMePostLike[]> {
  const cap = Math.max(1, Math.min(40, maxDocs));
  incrementDbOps("queries", 1);
  const snap = await db.collection("posts").orderBy("time", "desc").limit(cap).get();
  incrementDbOps("reads", snap.docs.length);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

function filterByRadius(posts: NearMePostLike[], lat: number, lng: number, radiusKm: number): NearMePostLike[] {
  const out: NearMePostLike[] = [];
  const seen = new Set<string>();
  for (const p of posts) {
    if (!isVisibleNearMePost(p)) continue;
    const c = getPostCoordinates(p as Record<string, unknown>);
    if (c.lat == null || c.lng == null) continue;
    const km = distanceKm(lat, lng, c.lat, c.lng);
    if (km <= radiusKm && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

function sortByDistance(posts: NearMePostLike[], lat: number, lng: number): NearMePostLike[] {
  return [...posts].sort((a, b) => {
    const ca = getPostCoordinates(a as Record<string, unknown>);
    const cb = getPostCoordinates(b as Record<string, unknown>);
    if (!ca.lat || !ca.lng || !cb.lat || !cb.lng) return 0;
    const da = distanceKm(lat, lng, ca.lat, ca.lng);
    const db = distanceKm(lat, lng, cb.lat, cb.lng);
    if (da !== db) return da - db;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Loads candidates across three bounded phases (40 + 40 + 40 Firestore reads max).
 */
export async function loadBoundedNearMeCandidates(input: {
  db: Firestore;
  lat: number;
  lng: number;
  radiusMiles: number;
}): Promise<{ posts: NearMePostLike[]; debug: Omit<BoundedNearMeDebug, "cacheHit"> }> {
  const radiusPhases: string[] = [];
  let readsUsed = 0;
  const budget = NEAR_ME_COLD_MAX_DOCS;
  const perPhase = 40;

  const radiusKmBase = input.radiusMiles * 1.60934;
  const radiusKmPhase2 = radiusKmBase * 2.25;
  const radiusKmPhase3 = radiusKmBase * 4;

  const merged: NearMePostLike[] = [];
  const mergeUnique = (batch: NearMePostLike[]) => {
    const known = new Set(merged.map((p) => p.id));
    for (const p of batch) {
      if (!known.has(p.id)) {
        known.add(p.id);
        merged.push(p);
      }
    }
  };

  // Phase 1 — precision-5 geohash tiles around center (strict radius filter)
  radiusPhases.push(`p1_geohash5_strict_${radiusKmBase.toFixed(1)}km`);
  const p5 = await geoPrefixesAroundCenter({ lat: input.lat, lng: input.lng, precision: 5 });
  let p1Reads = 0;
  for (const px of p5.slice(0, 4)) {
    if (readsUsed >= budget || p1Reads >= perPhase) break;
    const remain = Math.min(perPhase - p1Reads, budget - readsUsed);
    const chunk = await queryGeohashPrefixDocs(input.db, px, remain);
    p1Reads += chunk.length;
    readsUsed += chunk.length;
    mergeUnique(filterByRadius(chunk, input.lat, input.lng, radiusKmBase));
  }

  // Phase 2 — broader precision-4 prefix slice (expanded radius filter), single extra geographic query shape
  if (merged.length < 8 && readsUsed < budget) {
    radiusPhases.push(`p2_geohash4_expand_${radiusKmPhase2.toFixed(1)}km`);
    const p4 = await geoPrefixesAroundCenter({ lat: input.lat, lng: input.lng, precision: 4 });
    const px = p4[0];
    if (px) {
      const remain = Math.min(perPhase, budget - readsUsed);
      const chunk = await queryGeohashPrefixDocs(input.db, px, remain);
      readsUsed += chunk.length;
      mergeUnique(filterByRadius(chunk, input.lat, input.lng, radiusKmPhase2));
    }
  }

  // Phase 3 — bounded recent fallback for cold rural tiles (still <=40 reads)
  if (merged.length < 6 && readsUsed < budget) {
    radiusPhases.push(`p3_recent_time_desc_fallback_${radiusKmPhase3.toFixed(1)}km`);
    const remain = Math.min(perPhase, budget - readsUsed);
    const recent = await queryRecentTimeDesc(input.db, remain);
    readsUsed += recent.length;
    mergeUnique(filterByRadius(recent, input.lat, input.lng, radiusKmPhase3));
  }

  const sorted = sortByDistance(merged, input.lat, input.lng).slice(0, 240);

  return {
    posts: sorted,
    debug: {
      querySource: "bounded_near_me_v2",
      readBudgetUsed: readsUsed,
      readBudgetMax: budget,
      candidateCount: sorted.length,
      radiusPhases,
    },
  };
}

export function nearMeCacheKey(input: { lat: number; lng: number; radiusMiles: number; activity?: string | null }): string {
  const a = input.activity?.trim() || "all";
  return `${roundCoord(input.lat, 3)}_${roundCoord(input.lng, 3)}_${Math.round(input.radiusMiles)}_${a}`;
}
