import type { Firestore } from "firebase-admin/firestore";
import { getFastStartRawAssetRows } from "../../lib/posts/master-post-v2/videoFastStartRepair.js";

const SELECT_FIELDS = [
  "title",
  "lat",
  "lng",
  "long",
  "userId",
  "ownerId",
  "mediaType",
  "assets",
  "media"
] as const;

export type DuplicatePairReason = "same_lat_lng" | "same_title";

/** Per-post snapshot from stored fields only (no remote probe). */
export type PostVideoPlaybackSummary = {
  hasVideoAsset: boolean;
  /** `video.playback.defaultUrl` or `primaryUrl` on the first video row, when present. */
  defaultPlaybackUrl: string | null;
  /** From `hasAudio`, `codecs.audio`, or compact `video.technical.audioCodec`; null = unknown. */
  hasAudio: boolean | null;
};

export type UserPostDuplicatePair = {
  pairIndex: number;
  postIdA: string;
  postIdB: string;
  reasons: DuplicatePairReason[];
  /** Present when `same_title` applies (trimmed, exact match). */
  sharedTitle: string | null;
  /** Present when `same_lat_lng` applies. */
  sharedLatLng: { lat: number; lng: number } | null;
  postAVideo: PostVideoPlaybackSummary;
  postBVideo: PostVideoPlaybackSummary;
};

export type UserPostLight = {
  postId: string;
  title: string;
  lat: number | null;
  lng: number | null;
};

function readLng(data: Record<string, unknown>): number | null {
  const lng = Number(data.lng);
  const long = Number(data.long);
  if (Number.isFinite(lng)) return lng;
  if (Number.isFinite(long)) return long;
  return null;
}

function readLat(data: Record<string, unknown>): number | null {
  const lat = Number(data.lat);
  return Number.isFinite(lat) ? lat : null;
}

function readTitle(data: Record<string, unknown>): string {
  return String(data.title ?? "").trim();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Summarize first video asset on a live post doc: default playback URL + whether audio is indicated in metadata.
 */
export function summarizePostVideoPlayback(raw: Record<string, unknown>): PostVideoPlaybackSummary {
  const rows = getFastStartRawAssetRows(raw);
  const videoRow = (rows as Array<Record<string, unknown>>).find(
    (r) => String(r?.type ?? r?.mediaType ?? "").toLowerCase() === "video"
  );
  const mediaTypeVideo = String(raw.mediaType ?? "").toLowerCase() === "video";

  if (!videoRow) {
    if (!mediaTypeVideo) {
      return { hasVideoAsset: false, defaultPlaybackUrl: null, hasAudio: null };
    }
    const topAudio = raw.hasAudio;
    return {
      hasVideoAsset: true,
      defaultPlaybackUrl: null,
      hasAudio: typeof topAudio === "boolean" ? topAudio : null
    };
  }

  const video = asRecord(videoRow.video) ?? {};
  const playback = asRecord(video.playback) ?? {};
  let defaultPlaybackUrl: string | null = null;
  const def = typeof playback.defaultUrl === "string" ? playback.defaultUrl.trim() : "";
  const prim = typeof playback.primaryUrl === "string" ? playback.primaryUrl.trim() : "";
  if (def.startsWith("http")) defaultPlaybackUrl = def;
  else if (prim.startsWith("http")) defaultPlaybackUrl = prim;

  let hasAudio: boolean | null = null;
  if (typeof videoRow.hasAudio === "boolean") {
    hasAudio = videoRow.hasAudio;
  } else {
    const codecs = asRecord(videoRow.codecs);
    const audioCodec = codecs && typeof codecs.audio === "string" ? codecs.audio.trim().toLowerCase() : "";
    if (audioCodec === "none" || audioCodec === "no") hasAudio = false;
    else if (audioCodec.length > 0) hasAudio = true;

    const tech = asRecord(video.technical);
    if (hasAudio === null && tech && typeof tech.audioCodec === "string") {
      const ac = tech.audioCodec.trim().toLowerCase();
      if (ac === "none" || ac === "null") hasAudio = false;
      else if (ac.length > 0) hasAudio = true;
    }
  }

  return {
    hasVideoAsset: true,
    defaultPlaybackUrl,
    hasAudio
  };
}

export type DuplicatePairWithoutVideo = Omit<UserPostDuplicatePair, "pairIndex" | "postAVideo" | "postBVideo">;

/** All unordered pairs that share the same lat+lng or the same non-empty title. */
export function computeDuplicatePairs(posts: UserPostLight[]): Map<string, DuplicatePairWithoutVideo> {
  const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

  const merge = (
    map: Map<string, DuplicatePairWithoutVideo>,
    a: string,
    b: string,
    reason: DuplicatePairReason,
    sharedTitle: string | null,
    sharedLatLng: { lat: number; lng: number } | null
  ) => {
    if (a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = pairKey(x, y);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, {
        postIdA: x,
        postIdB: y,
        reasons: [reason],
        sharedTitle: reason === "same_title" ? sharedTitle : null,
        sharedLatLng: reason === "same_lat_lng" ? sharedLatLng : null
      });
      return;
    }
    if (!prev.reasons.includes(reason)) prev.reasons.push(reason);
    if (reason === "same_title" && sharedTitle) prev.sharedTitle = sharedTitle;
    if (reason === "same_lat_lng" && sharedLatLng) prev.sharedLatLng = sharedLatLng;
  };

  const out = new Map<string, DuplicatePairWithoutVideo>();

  const byLoc = new Map<string, string[]>();
  for (const p of posts) {
    if (p.lat === null || p.lng === null) continue;
    const key = `${p.lat}|${p.lng}`;
    const arr = byLoc.get(key) ?? [];
    arr.push(p.postId);
    byLoc.set(key, arr);
  }
  for (const [key, ids] of byLoc) {
    if (ids.length < 2) continue;
    const [la, lo] = key.split("|");
    const lat = Number(la);
    const lng = Number(lo);
    const loc = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    const sorted = [...new Set(ids)].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const idI = sorted[i];
        const idJ = sorted[j];
        if (idI && idJ) merge(out, idI, idJ, "same_lat_lng", null, loc);
      }
    }
  }

  const byTitle = new Map<string, string[]>();
  for (const p of posts) {
    if (!p.title) continue;
    const arr = byTitle.get(p.title) ?? [];
    arr.push(p.postId);
    byTitle.set(p.title, arr);
  }
  for (const [title, ids] of byTitle) {
    if (ids.length < 2) continue;
    const sorted = [...new Set(ids)].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const idI = sorted[i];
        const idJ = sorted[j];
        if (idI && idJ) merge(out, idI, idJ, "same_title", title, null);
      }
    }
  }

  return out;
}

export async function scanUserPostDuplicatePairs(input: {
  db: Firestore;
  userId: string;
  /** Per Firestore query; merged by doc id. Default 1000. */
  maxDocsPerQuery?: number;
}): Promise<{
  userId: string;
  postsScanned: number;
  possiblyTruncated: boolean;
  duplicatePairs: UserPostDuplicatePair[];
  posts: UserPostLight[];
}> {
  const uid = String(input.userId ?? "").trim();
  if (!uid) {
    return { userId: "", postsScanned: 0, possiblyTruncated: false, duplicatePairs: [], posts: [] };
  }
  const cap = Math.min(2000, Math.max(1, Math.floor(input.maxDocsPerQuery ?? 1000)));

  const snapUser = await input.db
    .collection("posts")
    .where("userId", "==", uid)
    .select(...SELECT_FIELDS)
    .limit(cap)
    .get();
  const snapOwner = await input.db
    .collection("posts")
    .where("ownerId", "==", uid)
    .select(...SELECT_FIELDS)
    .limit(cap)
    .get();

  const byId = new Map<string, UserPostLight>();
  const byRaw = new Map<string, Record<string, unknown>>();
  for (const doc of snapUser.docs) {
    const d = (doc.data() ?? {}) as Record<string, unknown>;
    byRaw.set(doc.id, d);
    byId.set(doc.id, {
      postId: doc.id,
      title: readTitle(d),
      lat: readLat(d),
      lng: readLng(d)
    });
  }
  for (const doc of snapOwner.docs) {
    const d = (doc.data() ?? {}) as Record<string, unknown>;
    byRaw.set(doc.id, d);
    byId.set(doc.id, {
      postId: doc.id,
      title: readTitle(d),
      lat: readLat(d),
      lng: readLng(d)
    });
  }

  const posts = [...byId.values()].sort((a, b) => a.postId.localeCompare(b.postId));
  const pairMap = computeDuplicatePairs(posts);
  const duplicatePairs: UserPostDuplicatePair[] = [...pairMap.values()]
    .sort((a, b) => a.postIdA.localeCompare(b.postIdA) || a.postIdB.localeCompare(b.postIdB))
    .map((row, i) => ({
      ...row,
      pairIndex: i + 1,
      postAVideo: summarizePostVideoPlayback(byRaw.get(row.postIdA) ?? {}),
      postBVideo: summarizePostVideoPlayback(byRaw.get(row.postIdB) ?? {})
    }));

  const possiblyTruncated = snapUser.docs.length >= cap || snapOwner.docs.length >= cap;

  return {
    userId: uid,
    postsScanned: posts.length,
    possiblyTruncated,
    duplicatePairs,
    posts
  };
}
