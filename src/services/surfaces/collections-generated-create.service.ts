import { FieldValue } from "firebase-admin/firestore";
import { MixPostsRepository, type MixPostRow } from "../../repositories/mixPosts.repository.js";
import { CollectionsFirestoreAdapter } from "../../repositories/source-of-truth/collections-firestore.adapter.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { getBestPostCover } from "../mixes/mixCover.service.js";

function clampPostCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 12;
  return Math.max(4, Math.min(24, Math.floor(v)));
}

function normalizeActivities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 3959;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa));
  return R * c;
}

function postLatLng(row: MixPostRow): { lat: number; lng: number } | null {
  const lat = Number((row as { lat?: unknown }).lat ?? (row as { location?: { lat?: unknown } }).location?.lat);
  const lng = Number(
    (row as { lng?: unknown }).lng ??
      (row as { long?: unknown }).long ??
      (row as { location?: { lng?: unknown } }).location?.lng,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function filterByRadius(rows: MixPostRow[], center: { lat: number; lng: number }, radiusMiles: number): MixPostRow[] {
  const out: MixPostRow[] = [];
  for (const row of rows) {
    const ll = postLatLng(row);
    if (!ll) continue;
    if (milesBetween(center, ll) <= radiusMiles) out.push(row);
  }
  return out;
}

function buildMixTitle(activities: string[]): string {
  if (activities.length === 0) return "Mix";
  const first = activities[0];
  if (activities.length === 1 && first !== undefined) {
    return `${first.replace(/[_-]+/g, " ")} mix`;
  }
  return `Mix · ${activities.length} activities`;
}

export class CollectionsGeneratedCreateService {
  private readonly posts = new MixPostsRepository();
  private readonly collections = new CollectionsFirestoreAdapter();

  async createMix(input: {
    viewerId: string;
    activities: string[];
    postCount?: number;
    lat?: number | null;
    lng?: number | null;
    radiusMiles?: number | null;
    prompt?: string | null;
  }): Promise<{ success: true; collectionId: string } | { success: false; error: string }> {
    const viewerId = String(input.viewerId ?? "").trim();
    if (!viewerId) return { success: false, error: "viewer_required" };
    const activities = normalizeActivities(input.activities);
    if (activities.length === 0) {
      return { success: false, error: "Add at least one activity for this mix." };
    }
    const postCount = clampPostCount(input.postCount);
    const lat = typeof input.lat === "number" && Number.isFinite(input.lat) ? input.lat : null;
    const lng = typeof input.lng === "number" && Number.isFinite(input.lng) ? input.lng : null;
    const radiusMiles =
      typeof input.radiusMiles === "number" && Number.isFinite(input.radiusMiles)
        ? Math.min(50, Math.max(1, input.radiusMiles))
        : null;
    const hasGeo = lat != null && lng != null && radiusMiles != null;

    const poolLimit = hasGeo ? Math.min(120, postCount * 14) : Math.min(80, postCount * 8);
    const page = await this.posts.pageByActivities({
      activities,
      limit: poolLimit,
      cursor: null,
    });
    let ranked = page.items;
    if (hasGeo && lat != null && lng != null && radiusMiles != null) {
      ranked = filterByRadius(ranked, { lat, lng }, radiusMiles);
    }
    ranked = ranked.slice(0, postCount);
    if (ranked.length === 0) {
      return {
        success: false,
        error: hasGeo
          ? "No posts matched that mix in this area. Try a wider radius or different activities."
          : "No posts matched that mix right now.",
      };
    }
    const postIds = ranked.map((p) => String(p.postId ?? p.id ?? "").trim()).filter(Boolean);
    const cover = getBestPostCover(ranked[0] as Record<string, unknown>);
    const name = buildMixTitle(activities);
    const created = await this.collections.createCollection({
      viewerId,
      name,
      description: String(input.prompt ?? "").trim() || `Posts across: ${activities.join(", ")}`,
      privacy: "public",
      collaborators: [viewerId],
      items: postIds,
      coverUri: cover.coverImageUrl ?? undefined,
      color: "#5BA67F",
    });
    const generatedBy = {
      type: "mix" as const,
      createdAtMs: Date.now(),
      postCount: postIds.length,
      activities,
      ...(String(input.prompt ?? "").trim() ? { prompt: String(input.prompt).trim() } : {}),
      ...(hasGeo && lat != null && lng != null && radiusMiles != null ? { lat, lng, radiusMiles } : {}),
    };
    const db = getFirestoreSourceClient();
    if (!db) return { success: false, error: "collections_unavailable" };
    await db
      .collection("collections")
      .doc(created.id)
      .update({
        generatedBy,
        items: postIds,
        itemsCount: postIds.length,
        lastContentActivityAtMs: Date.now(),
        lastContentActivityByUserId: viewerId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    await this.collections.getCollection({ viewerId, collectionId: created.id }, { fresh: true });
    return { success: true, collectionId: created.id };
  }

  async createBlend(input: {
    viewerId: string;
    userIds: string[];
    postCount?: number;
  }): Promise<{ success: true; collectionId: string } | { success: false; error: string }> {
    const viewerId = String(input.viewerId ?? "").trim();
    if (!viewerId) return { success: false, error: "viewer_required" };
    const others = Array.from(
      new Set((input.userIds ?? []).map((id) => String(id).trim()).filter((id) => id && id !== viewerId)),
    );
    if (others.length === 0) {
      return { success: false, error: "Pick at least one person to make a blend." };
    }
    const postCount = clampPostCount(input.postCount);
    const sourceIds = [viewerId, ...others].slice(0, 24);
    const chunks = sourceIds.map((id) => [id]);
    const merged = await this.posts.pageByAuthorIdsMerged({
      authorIdChunks: chunks,
      limit: postCount,
      perChunkCursor: chunks.map(() => ({ lastTime: null, lastId: null, exhausted: false })),
    });
    const posts = merged.items.slice(0, postCount);
    if (posts.length === 0) {
      return { success: false, error: "No posts matched that blend right now." };
    }
    const postIds = posts.map((p) => String(p.postId ?? p.id ?? "").trim()).filter(Boolean);
    const cover = getBestPostCover(posts[0] as Record<string, unknown>);
    const name = `Blend · ${others.length + 1} people`;
    const created = await this.collections.createCollection({
      viewerId,
      name,
      description: "Taste blend from the people you picked.",
      privacy: "public",
      collaborators: [viewerId],
      items: postIds,
      coverUri: cover.coverImageUrl ?? undefined,
      color: "#6E7FF2",
    });
    const generatedBy = {
      type: "blend" as const,
      createdAtMs: Date.now(),
      postCount: postIds.length,
      sourceUserIds: others,
    };
    const db = getFirestoreSourceClient();
    if (!db) return { success: false, error: "collections_unavailable" };
    await db
      .collection("collections")
      .doc(created.id)
      .update({
        generatedBy,
        items: postIds,
        itemsCount: postIds.length,
        lastContentActivityAtMs: Date.now(),
        lastContentActivityByUserId: viewerId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    await this.collections.getCollection({ viewerId, collectionId: created.id }, { fresh: true });
    return { success: true, collectionId: created.id };
  }
}
