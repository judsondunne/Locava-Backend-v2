import { describe, expect, it } from "vitest";
import { createApp } from "../app/createApp.js";
import { getFirestoreSourceClient } from "../repositories/source-of-truth/firestore-client.js";

type TruthPost = {
  id: string;
  activities: string[];
  stateRegionId: string | null;
  cityRegionId: string | null;
  lat: number | null;
  lng: number | null;
  hasCover: boolean;
};

function asNum(v: unknown): number | null {
  const n = Number(v ?? NaN);
  return Number.isFinite(n) ? n : null;
}

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy) * 69;
}

function hasAnyCover(doc: Record<string, unknown>): boolean {
  const direct = String(doc.thumbUrl ?? doc.displayPhotoLink ?? doc.photoLink ?? "").trim();
  if (/^https?:\/\//i.test(direct)) return true;
  const assets = doc.assets;
  if (!Array.isArray(assets) || assets.length === 0 || typeof assets[0] !== "object" || !assets[0]) return false;
  const a0 = assets[0] as Record<string, unknown>;
  const candidates = [a0.poster, a0.thumbnail, a0.original, (a0.variants as any)?.poster];
  return candidates.some((c) => typeof c === "string" && /^https?:\/\//i.test(c.trim()));
}

async function loadTruthPosts(): Promise<Map<string, TruthPost>> {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("truth_harness_requires_firestore_source");
  }
  const snap = await db.collection("posts").get();
  const out = new Map<string, TruthPost>();
  for (const doc of snap.docs) {
    if (!doc.id.startsWith("truth-")) continue;
    const data = doc.data() as Record<string, unknown>;
    out.set(doc.id, {
      id: doc.id,
      activities: Array.isArray(data.activities) ? data.activities.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean) : [],
      stateRegionId: String(data.stateRegionId ?? "").trim() || null,
      cityRegionId: String(data.cityRegionId ?? "").trim() || null,
      lat: asNum(data.lat),
      lng: asNum(data.lng ?? data.long),
      hasCover: hasAnyCover(data),
    });
  }
  return out;
}

async function fetchAllCommittedIds(
  app: any,
  q: string,
  opts: { lat?: number; lng?: number; limit?: number } = {},
): Promise<{ ids: string[]; firstDebug: any | null }> {
  const limit = opts.limit ?? 10;
  const seen = new Set<string>();
  const ordered: string[] = [];
  let cursor: string | null = null;
  let firstDebug: any | null = null;
  for (let page = 0; page < 30; page += 1) {
    const sp = new URLSearchParams();
    sp.set("q", q);
    sp.set("limit", String(limit));
    sp.set("debug", "1");
    if (typeof opts.lat === "number") sp.set("lat", String(opts.lat));
    if (typeof opts.lng === "number") sp.set("lng", String(opts.lng));
    if (cursor) sp.set("cursor", cursor);
    const res = await app.inject({
      method: "GET",
      url: `/v2/search/results?${sp.toString()}`,
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as any;
    if (page === 0) firstDebug = data.debugSearch ?? null;
    const items = (data.sections?.posts?.items ?? data.items ?? []) as Array<{ postId: string }>;
    for (const row of items) {
      const id = String(row.postId ?? "").trim();
      if (!id) continue;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      ordered.push(id);
    }
    if (!data.page?.hasMore || !data.page?.nextCursor) break;
    cursor = data.page.nextCursor;
  }
  return { ids: ordered, firstDebug };
}

describe("Firestore truth harness (seeded dataset, independent expected)", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewer = { lat: 40.68843, lng: -75.22073 };
  const vtState = "us:vermont";
  const vtBurl = "us:vermont:burlington";

  it("committed results are exhaustive under cap: swimming in Vermont", async () => {
    const truth = await loadTruthPosts();
    const expected = [...truth.values()]
      .filter((p) => p.id.startsWith("truth-swim-vt-"))
      .filter((p) => p.stateRegionId === vtState)
      .filter((p) => p.hasCover)
      .map((p) => p.id)
      .sort();

    const got = await fetchAllCommittedIds(app, "swimming in Vermont", { limit: 10 });
    expect(got.firstDebug?.repoDebug?.location?.stateRegionId ?? got.firstDebug?.repoDebug?.location).toBeTruthy();
    expect(new Set(got.ids)).toEqual(new Set(expected));

    // Stable deterministic order (same query twice yields same sequence).
    const got2 = await fetchAllCommittedIds(app, "swimming in Vermont", { limit: 10 });
    expect(got2.ids).toEqual(got.ids);
  });

  it("committed results: hiking in Vermont matches only hiking VT posts", async () => {
    const truth = await loadTruthPosts();
    const expected = [...truth.values()]
      .filter((p) => p.id.startsWith("truth-hike-vt-"))
      .filter((p) => p.stateRegionId === vtState)
      .filter((p) => p.hasCover)
      .map((p) => p.id)
      .sort();
    const got = await fetchAllCommittedIds(app, "hiking in Vermont", { limit: 10 });
    expect(got.firstDebug?.repoDebug?.location?.stateRegionId ?? got.firstDebug?.repoDebug?.location).toBeTruthy();
    expect(new Set(got.ids)).toEqual(new Set(expected));
  });

  it("committed results: swimming in Burlington is city-scoped and excludes other VT swimming posts", async () => {
    const truth = await loadTruthPosts();
    const expected = [...truth.values()]
      .filter((p) => p.id.startsWith("truth-swim-vt-"))
      .filter((p) => p.cityRegionId === vtBurl)
      .filter((p) => p.hasCover)
      .map((p) => p.id)
      .sort();
    const got = await fetchAllCommittedIds(app, "swimming in Burlington", { limit: 10 });
    expect(got.firstDebug?.repoDebug?.location?.cityRegionId ?? got.firstDebug?.repoDebug?.location).toBeTruthy();
    expect(new Set(got.ids)).toEqual(new Set(expected));
  });

  it("near me expands outward and does not leak too-far posts early", async () => {
    const truth = await loadTruthPosts();
    const expectedIds = [...truth.values()]
      .filter((p) => p.id.startsWith("truth-swim-"))
      .filter((p) => p.hasCover)
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ id: p.id, miles: distanceMiles(viewer, { lat: p.lat!, lng: p.lng! }) }))
      .filter((row) => row.miles <= 120)
      .sort((a, b) => a.miles - b.miles || a.id.localeCompare(b.id))
      .map((row) => row.id);

    const got = await fetchAllCommittedIds(app, "swimming near me", { lat: viewer.lat, lng: viewer.lng, limit: 8 });
    expect(got.ids.length).toBeGreaterThan(0);
    // Should be a subset of <=120mi matches; should not contain the "too-far" posts (~180mi).
    expect(got.ids.some((id) => id.includes("too-far"))).toBe(false);

    // Ordering: distances should be non-decreasing across the returned list.
    const gotMiles = got.ids.map((id) => {
      const p = truth.get(id);
      expect(p).toBeTruthy();
      return distanceMiles(viewer, { lat: p!.lat!, lng: p!.lng! });
    });
    for (let i = 1; i < gotMiles.length; i += 1) {
      expect(gotMiles[i]!).toBeGreaterThanOrEqual(gotMiles[i - 1]! - 0.001);
    }

    // And the ids should match the closest-first expectation for this dataset (first page).
    expect(got.ids).toEqual(expectedIds.slice(0, got.ids.length));
  });

  it("best-places phrasing maps to same universe as swimming in Vermont", async () => {
    const a = await fetchAllCommittedIds(app, "swimming in Vermont", { limit: 10 });
    const b = await fetchAllCommittedIds(app, "best places to swim in Vermont", { limit: 10 });
    expect(new Set(b.ids)).toEqual(new Set(a.ids));
  });
});
