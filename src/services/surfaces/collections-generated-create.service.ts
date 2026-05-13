import { FieldValue } from "firebase-admin/firestore";
import type { MixFilter } from "../../contracts/v2/mixes.contract.js";
import { MixesOrchestrator } from "../../orchestration/mixes/mixes.orchestrator.js";
import { MixPostsRepository } from "../../repositories/mixPosts.repository.js";
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

function milesToKm(miles: number): number {
  return miles * 1.609344;
}

function buildMixTitle(activities: string[]): string {
  if (activities.length === 0) return "Mix";
  const first = activities[0];
  if (activities.length === 1 && first !== undefined) {
    return `${first.replace(/[_-]+/g, " ")} mix`;
  }
  return `Mix · ${activities.length} activities`;
}

function postIdsFromMixPagePayload(payload: { posts?: Array<{ postId?: string }> }): string[] {
  const posts = Array.isArray(payload.posts) ? payload.posts : [];
  return posts.map((p) => String(p.postId ?? "").trim()).filter(Boolean);
}

function firstMixCardFromPayload(payload: unknown): Record<string, unknown> | null {
  const p = payload as { posts?: unknown[] };
  const row = Array.isArray(p.posts) && p.posts[0] && typeof p.posts[0] === "object" ? (p.posts[0] as Record<string, unknown>) : null;
  return row;
}

/**
 * Resolves initial post IDs using {@link MixesOrchestrator} — the same implementation
 * backing `GET /v2/mixes/:mixKey/page` (Search / home mix cards).
 */
async function collectMixPostIdsViaSearchMixEngine(params: {
  viewerId: string;
  activities: string[];
  lat: number | null;
  lng: number | null;
  radiusMiles: number | null;
  postCount: number;
}): Promise<{ postIds: string[]; mixKeyUsed: string; coverRow: Record<string, unknown> | null }> {
  const orchestrator = new MixesOrchestrator();
  const limit = Math.max(1, Math.min(24, Math.floor(params.postCount)));
  const lat = params.lat;
  const lng = params.lng;
  const radiusKm =
    lat != null && lng != null && params.radiusMiles != null
      ? Math.min(500, Math.max(1e-6, milesToKm(Math.min(50, Math.max(1, params.radiusMiles)))))
      : undefined;
  const hasGeo = lat != null && lng != null && radiusKm != null;
  const acts = params.activities;

  const mergeDedupe = (into: string[], next: string[], cap: number): void => {
    const seen = new Set(into);
    for (const id of next) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      into.push(id);
      if (into.length >= cap) return;
    }
  };

  let coverRow: Record<string, unknown> | null = null;

  if (hasGeo && acts.length === 0) {
    const payload = await orchestrator.page({
      mixKey: "nearby",
      filter: { lat: lat!, lng: lng!, radiusKm } satisfies MixFilter,
      limit,
      cursor: null,
      viewerId: params.viewerId,
    });
    coverRow = firstMixCardFromPayload(payload);
    return { postIds: postIdsFromMixPagePayload(payload).slice(0, limit), mixKeyUsed: "nearby", coverRow };
  }

  if (hasGeo && acts.length > 0) {
    const out: string[] = [];
    const first = acts[0]!;
    const p1 = await orchestrator.page({
      mixKey: "nearby",
      filter: { activity: first, lat: lat!, lng: lng!, radiusKm } satisfies MixFilter,
      limit,
      cursor: null,
      viewerId: params.viewerId,
    });
    coverRow = firstMixCardFromPayload(p1);
    mergeDedupe(out, postIdsFromMixPagePayload(p1), limit);
    for (const act of acts.slice(1, 5)) {
      if (out.length >= limit) break;
      const p2 = await orchestrator.page({
        mixKey: "nearby",
        filter: { activity: act, lat: lat!, lng: lng!, radiusKm } satisfies MixFilter,
        limit: Math.min(12, limit),
        cursor: null,
        viewerId: params.viewerId,
      });
      if (!coverRow) coverRow = firstMixCardFromPayload(p2);
      mergeDedupe(out, postIdsFromMixPagePayload(p2), limit);
    }
    return { postIds: out, mixKeyUsed: "nearby", coverRow };
  }

  if (!hasGeo && acts.length === 1) {
    const act = acts[0]!;
    const payload = await orchestrator.page({
      mixKey: act,
      filter: { activity: act } satisfies MixFilter,
      limit,
      cursor: null,
      viewerId: params.viewerId,
    });
    coverRow = firstMixCardFromPayload(payload);
    return { postIds: postIdsFromMixPagePayload(payload).slice(0, limit), mixKeyUsed: act, coverRow };
  }

  if (!hasGeo && acts.length > 1) {
    const out: string[] = [];
    for (const act of acts.slice(0, 4)) {
      if (out.length >= limit) break;
      const payload = await orchestrator.page({
        mixKey: act,
        filter: { activity: act } satisfies MixFilter,
        limit: Math.ceil(limit / acts.length) + 4,
        cursor: null,
        viewerId: params.viewerId,
      });
      if (!coverRow) coverRow = firstMixCardFromPayload(payload);
      mergeDedupe(out, postIdsFromMixPagePayload(payload), limit);
    }
    return { postIds: out, mixKeyUsed: acts.join("|"), coverRow };
  }

  return { postIds: [], mixKeyUsed: "none", coverRow: null };
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
    const postCount = clampPostCount(input.postCount);
    const lat = typeof input.lat === "number" && Number.isFinite(input.lat) ? input.lat : null;
    const lng = typeof input.lng === "number" && Number.isFinite(input.lng) ? input.lng : null;
    const radiusMiles =
      typeof input.radiusMiles === "number" && Number.isFinite(input.radiusMiles)
        ? Math.min(50, Math.max(1, input.radiusMiles))
        : null;
    const hasGeo = lat != null && lng != null && radiusMiles != null;
    if (activities.length === 0 && !hasGeo) {
      return {
        success: false,
        error: "Add at least one activity, or send lat, lng, and radiusMiles for a nearby-only mix.",
      };
    }

    const { postIds, mixKeyUsed, coverRow } = await collectMixPostIdsViaSearchMixEngine({
      viewerId,
      activities,
      lat,
      lng,
      radiusMiles,
      postCount,
    });

    const defaultName =
      activities.length > 0 ? buildMixTitle(activities) : hasGeo ? "Nearby mix" : "Mix";
    const prompt = String(input.prompt ?? "").trim();
    const description =
      prompt ||
      (postIds.length > 0
        ? activities.length > 0
          ? `Posts across: ${activities.join(", ")}`
          : "Posts near the area you picked."
        : activities.length > 0
          ? "No posts matched those activities yet. Try different activities or widen the area."
          : "No posts in this area yet — widen the radius or check back later.");

    const cover =
      postIds.length > 0 && coverRow
        ? getBestPostCover(coverRow)
        : { coverImageUrl: null as string | null, coverPostId: null as string | null };

    const created = await this.collections.createCollection({
      viewerId,
      name: defaultName,
      description,
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
      mixEngine: "v2_mixes_orchestrator_page" as const,
      mixKeyUsed,
      ...(prompt ? { prompt } : {}),
      ...(hasGeo && lat != null && lng != null && radiusMiles != null ? { lat, lng, radiusMiles } : {}),
      ...(postIds.length === 0 ? { emptyMix: true as const } : {}),
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
    const postIds = posts.map((p) => String(p.postId ?? p.id ?? "").trim()).filter(Boolean);
    const cover =
      postIds.length > 0
        ? getBestPostCover(posts[0] as Record<string, unknown>)
        : { coverImageUrl: null as string | null, coverPostId: null as string | null };
    const name = `Blend · ${others.length + 1} people`;
    const description =
      postIds.length > 0
        ? "Taste blend from the people you picked."
        : "No posts from these people yet — check back as they add spots.";
    const created = await this.collections.createCollection({
      viewerId,
      name,
      description,
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
      memberUserIds: sourceIds,
      ...(postIds.length === 0 ? { emptyBlend: true as const } : {}),
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
