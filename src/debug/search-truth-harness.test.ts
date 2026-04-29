import { describe, expect, it } from "vitest";
import { createApp } from "../app/createApp.js";
import { SearchDiscoveryService } from "../services/surfaces/search-discovery.service.js";
import { normalizeSearchText, parseSearchQueryIntent } from "../lib/search-query-intent.js";

type TruthScore = {
  postId: string;
  activityMatch: { ok: boolean; matchedBy: string[] };
  locationMatch: { ok: boolean; matchedBy: string[]; distanceMiles?: number | null };
  hasCoverMedia: boolean;
};

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy) * 69;
}

function resolvePosterUrlFromDoc(row: Record<string, unknown>): string | null {
  const direct = String(row.thumbUrl ?? row.displayPhotoLink ?? row.photoLink ?? "").trim();
  if (/^https?:\/\//i.test(direct)) return direct;
  const assets = row.assets;
  if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {
    const a0 = assets[0] as Record<string, unknown>;
    const candidates = [a0.poster, a0.thumbnail, a0.original, (a0.variants as any)?.poster];
    for (const c of candidates) {
      const u = typeof c === "string" ? c.trim() : "";
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  return null;
}

function scorePostAgainstIntent(input: {
  rawQuery: string;
  post: Record<string, unknown>;
  viewerCoords: { lat: number; lng: number } | null;
}): TruthScore {
  const intent = parseSearchQueryIntent(input.rawQuery);
  const postId = String(input.post.postId ?? input.post.id ?? "").trim();
  const activities = Array.isArray(input.post.activities)
    ? (input.post.activities as unknown[]).map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  const title = String(input.post.title ?? "").trim();
  const caption = String(input.post.caption ?? input.post.content ?? "").trim();
  const description = String(input.post.description ?? "").trim();
  const corpus = normalizeSearchText(`${title} ${caption} ${description}`);

  const activityMatchedBy: string[] = [];
  if (intent.activity?.queryActivities?.length) {
    for (const key of intent.activity.queryActivities) {
      const k = normalizeSearchText(String(key ?? "")).replace(/\s+/g, "");
      if (!k) continue;
      const hasActivity = activities.some((a) => normalizeSearchText(a).replace(/\s+/g, "").includes(k));
      const hasText = corpus.includes(normalizeSearchText(String(key ?? "")));
      if (hasActivity) activityMatchedBy.push(`activities:${k}`);
      else if (hasText) activityMatchedBy.push(`text:${k}`);
    }
  }
  const activityOk = intent.activity ? activityMatchedBy.length > 0 : true;

  const stateRegionId = String(input.post.stateRegionId ?? "").trim() || null;
  const cityRegionId = String(input.post.cityRegionId ?? "").trim() || null;
  const locationMatchedBy: string[] = [];
  if (intent.nearMe) {
    const lat = Number(input.post.lat ?? NaN);
    const lng = Number(input.post.lng ?? input.post.long ?? NaN);
    if (input.viewerCoords && Number.isFinite(lat) && Number.isFinite(lng)) {
      const miles = distanceMiles(input.viewerCoords, { lat, lng });
      if (Number.isFinite(miles) && miles <= 120) locationMatchedBy.push(`near_me<=120:${miles.toFixed(1)}`);
      return {
        postId,
        activityMatch: { ok: activityOk, matchedBy: activityMatchedBy },
        locationMatch: { ok: locationMatchedBy.length > 0, matchedBy: locationMatchedBy, distanceMiles: miles },
        hasCoverMedia: resolvePosterUrlFromDoc(input.post) != null,
      };
    }
    return {
      postId,
      activityMatch: { ok: activityOk, matchedBy: activityMatchedBy },
      locationMatch: { ok: false, matchedBy: ["near_me_missing_coords"], distanceMiles: null },
      hasCoverMedia: resolvePosterUrlFromDoc(input.post) != null,
    };
  }

  if (intent.location?.cityRegionId || intent.location?.stateRegionId) {
    if (intent.location.cityRegionId && cityRegionId && cityRegionId === intent.location.cityRegionId) {
      locationMatchedBy.push("cityRegionId");
    } else if (intent.location.stateRegionId && stateRegionId && stateRegionId === intent.location.stateRegionId) {
      locationMatchedBy.push("stateRegionId");
    }
  }
  const locationOk = intent.location ? locationMatchedBy.length > 0 : true;

  return {
    postId,
    activityMatch: { ok: activityOk, matchedBy: activityMatchedBy },
    locationMatch: { ok: locationOk, matchedBy: locationMatchedBy },
    hasCoverMedia: resolvePosterUrlFromDoc(input.post) != null,
  };
}

const firestoreHarnessEnabled =
  process.env.FIRESTORE_TEST_MODE === "emulator" ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const describeHarness = firestoreHarnessEnabled ? describe : describe.skip;

describeHarness("Search truth harness (firestore-backed)", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const discovery = new SearchDiscoveryService();

  async function runCommittedSearch(input: { q: string; lat?: number; lng?: number; limit?: number; cursor?: string | null }) {
    const sp = new URLSearchParams();
    sp.set("q", input.q);
    sp.set("limit", String(input.limit ?? 8));
    sp.set("debug", "1");
    if (typeof input.lat === "number") sp.set("lat", String(input.lat));
    if (typeof input.lng === "number") sp.set("lng", String(input.lng));
    if (input.cursor) sp.set("cursor", input.cursor);
    const res = await app.inject({
      method: "GET",
      url: `/v2/search/results?${sp.toString()}`,
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal",
      },
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return null;
    return res.json().data as any;
  }

  async function fetchPostsForValidation(postIds: string[]) {
    const rows = await discovery.loadPostsByIds(postIds);
    const map = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const id = String((row as any)?.postId ?? (row as any)?.id ?? "").trim();
      if (id) map.set(id, row as any);
    }
    return map;
  }

  async function assertTruth(input: { q: string; lat?: number; lng?: number }) {
    const data = await runCommittedSearch({ q: input.q, lat: input.lat, lng: input.lng, limit: 10 });
    if (!data) return; // emulator not reachable in this environment

    const items = (data.sections?.posts?.items ?? data.items ?? []) as Array<{ postId: string }>;
    expect(Array.isArray(items)).toBe(true);

    const postIds = items.map((r) => String(r.postId ?? "")).filter(Boolean);
    const hydrated = await fetchPostsForValidation(postIds);
    const viewerCoords =
      typeof input.lat === "number" && typeof input.lng === "number" ? { lat: input.lat, lng: input.lng } : null;

    const scores: TruthScore[] = [];
    for (const id of postIds) {
      const doc = hydrated.get(id);
      if (!doc) continue;
      scores.push(scorePostAgainstIntent({ rawQuery: input.q, post: doc, viewerCoords }));
    }

    // Must not leak obviously unrelated posts for structured activity+location queries.
    const intent = parseSearchQueryIntent(input.q);
    if (intent.activity && (intent.location || intent.nearMe)) {
      const leaks = scores.filter((s) => !s.activityMatch.ok || !s.locationMatch.ok);
      expect(leaks, `truth leaks for "${input.q}": ${JSON.stringify(leaks.slice(0, 6))}`).toEqual([]);
    }

    // Covers: if a post has assets, we should have a poster we can use.
    const missingCovers = scores.filter((s) => !s.hasCoverMedia);
    expect(missingCovers, `missing covers for "${input.q}": ${JSON.stringify(missingCovers.slice(0, 8))}`).toEqual([]);

    // Pagination should be able to retrieve more when hasMore.
    if (data.page?.hasMore && data.page?.nextCursor) {
      const page2 = await runCommittedSearch({ q: input.q, lat: input.lat, lng: input.lng, limit: 10, cursor: data.page.nextCursor });
      if (page2) {
        const items2 = (page2.sections?.posts?.items ?? page2.items ?? []) as Array<{ postId: string }>;
        expect(items2.length).toBeGreaterThan(0);
      }
    }
  }

  it("hiking in Vermont", async () => {
    await assertTruth({ q: "hiking in Vermont" });
  });

  it("best hikes in Vermont", async () => {
    await assertTruth({ q: "best hikes in Vermont" });
  });

  it("swimming in Pennsylvania", async () => {
    await assertTruth({ q: "swimming in Pennsylvania" });
  });

  it("swimming near me (coords)", async () => {
    await assertTruth({ q: "swimming near me", lat: 40.68843, lng: -75.22073 });
  });

  it("coffee shops in Easton", async () => {
    await assertTruth({ q: "coffee shops in Easton" });
  });

  it("waterfalls near me (coords)", async () => {
    await assertTruth({ q: "waterfalls near me", lat: 40.68843, lng: -75.22073 });
  });

  it("activity-only query returns many (hiking)", async () => {
    await assertTruth({ q: "hiking" });
  });

  it("location-only query returns many (Vermont)", async () => {
    await assertTruth({ q: "Vermont" });
  });

  it("expanded activity+location matrix (sanity)", async () => {
    const cases: Array<{ q: string; lat?: number; lng?: number }> = [
      { q: "hikes in Vermont" },
      { q: "trail hikes in Vermont" },
      { q: "swimming holes in Pennsylvania" },
      { q: "coffee in Easton" },
      { q: "waterfall hikes in Vermont" },
      { q: "views in Vermont" },
      { q: "swimming near me", lat: 40.68843, lng: -75.22073 },
      { q: "waterfalls nearby", lat: 40.68843, lng: -75.22073 },
    ];
    for (const c of cases) {
      // eslint-disable-next-line no-await-in-loop
      await assertTruth(c);
    }
  });

  it("mix bootstrap returns general mixes with covers and truthful gating", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/search/mixes/bootstrap?limit=8&includeDebug=1",
      headers: {
        "x-viewer-id": "internal-viewer",
        "x-viewer-roles": "internal",
      },
    });
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode !== 200) return;
    const body = res.json().data as any;
    const mixes = (body.mixes ?? []) as any[];
    expect(Array.isArray(mixes)).toBe(true);

    const general = mixes.filter((m) => m && m.type === "general");
    // Up to 8 general mixes; should not be empty when inventory exists.
    expect(general.length).toBeGreaterThan(0);

    for (const m of general) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.key).toBe("string");
      expect(m.hiddenReason == null).toBe(true);
      expect(typeof m.coverImageUrl).toBe("string");
      expect(/^https?:\/\//i.test(String(m.coverImageUrl))).toBe(true);
      expect(typeof m.coverPostId).toBe("string");
    }

    const nearby = mixes.find((m) => m && m.type === "nearby") as any;
    if (nearby) {
      expect(nearby.requiresLocation === true).toBe(true);
      if (nearby.hiddenReason === "missing_location") {
        expect(nearby.coverImageUrl).toBe(null);
      }
    }

    const friends = mixes.find((m) => m && m.type === "friends") as any;
    if (friends && friends.hiddenReason == null) {
      expect(friends.requiresFollowing === true).toBe(true);
      expect(/^https?:\/\//i.test(String(friends.coverImageUrl ?? ""))).toBe(true);
    }
  });

  it("opening a visible general mix returns paginated truthful posts", async () => {
    const bootstrap = await app.inject({
      method: "GET",
      url: "/v2/search/mixes/bootstrap?limit=8&includeDebug=0",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" },
    });
    expect([200, 503]).toContain(bootstrap.statusCode);
    if (bootstrap.statusCode !== 200) return;
    const mixes = (bootstrap.json().data.mixes ?? []) as any[];
    const general = mixes.find((m) => m && m.type === "general" && !m.hiddenReason) as any;
    if (!general) return;

    const page1 = await app.inject({
      method: "POST",
      url: "/v2/search/mixes/feed",
      headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal", "content-type": "application/json" },
      payload: JSON.stringify({ mixId: general.id, cursor: null, limit: 12, includeDebug: true }),
    });
    expect([200, 503]).toContain(page1.statusCode);
    if (page1.statusCode !== 200) return;
    const b1 = page1.json().data as any;
    expect(Array.isArray(b1.posts)).toBe(true);
    // If inventory exists for the card cover, opening shouldn't be trivially empty.
    expect(b1.posts.length).toBeGreaterThan(0);
    if (b1.hasMore && b1.nextCursor) {
      const page2 = await app.inject({
        method: "POST",
        url: "/v2/search/mixes/feed",
        headers: { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal", "content-type": "application/json" },
        payload: JSON.stringify({ mixId: general.id, cursor: b1.nextCursor, limit: 12, includeDebug: false }),
      });
      expect([200, 503]).toContain(page2.statusCode);
      if (page2.statusCode !== 200) return;
      const b2 = page2.json().data as any;
      const ids1 = new Set(b1.posts.map((p: any) => String(p.id ?? p.postId ?? "").trim()).filter(Boolean));
      const ids2 = b2.posts.map((p: any) => String(p.id ?? p.postId ?? "").trim()).filter(Boolean);
      expect(ids2.some((id: string) => ids1.has(id))).toBe(false);
    }
  });
});

