import { getBestPostCover } from "../mixes/mixCover.service.js";
import type { MixPostRow } from "../../repositories/mixPosts.repository.js";
import {
  membershipNormalizedSetForSearchHomeMix,
  normalizeActivityTagForSearchHome,
  resolveSearchHomeV1MixCanonicalKey,
} from "./search-home-v1.activity-aliases.js";

export type SearchHomeV1PostPreviewWire = {
  id: string;
  thumbnailUrl: string | null;
  mediaType: "photo" | "video";
  activity: string;
  title: string | null;
  placeName: string | null;
  createdAt: string;
};

export function mediaTypeFromRow(row: Record<string, unknown>): "photo" | "video" {
  const mt = String(row.mediaType ?? "").toLowerCase();
  if (mt === "video" || mt === "vid") return "video";
  const assets = row.assets;
  if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {
    const a0 = assets[0] as Record<string, unknown>;
    if (String(a0.type ?? "").toLowerCase() === "video") return "video";
  }
  return "photo";
}

function pickActivityForMix(row: Record<string, unknown>, activityKeyRaw: string, fallback: string): string {
  const allowed = membershipNormalizedSetForSearchHomeMix(activityKeyRaw);
  const acts = Array.isArray(row.activities) ? row.activities : [];
  for (const a of acts) {
    const n = normalizeActivityTagForSearchHome(String(a));
    if (allowed.has(n)) return n;
  }
  return fallback;
}

function postMatchesMembership(row: Record<string, unknown>, activityKeyRaw: string): boolean {
  const allowed = membershipNormalizedSetForSearchHomeMix(activityKeyRaw);
  if (allowed.size === 0) return false;
  const acts = Array.isArray(row.activities) ? row.activities : [];
  return acts.some((a) => allowed.has(normalizeActivityTagForSearchHome(String(a))));
}

function placeNameFromRow(row: Record<string, unknown>): string | null {
  const candidates = [
    row.placeName,
    row.locationName,
    row.address,
    (row.location as Record<string, unknown> | undefined)?.name,
    (row.geoTag as Record<string, unknown> | undefined)?.name,
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s) return s;
  }
  return null;
}

function createdAtIso(row: Record<string, unknown>): string {
  const t = Number(row.time ?? row.createdAtMs ?? row.updatedAtMs ?? 0);
  if (Number.isFinite(t) && t > 0) return new Date(t).toISOString();
  return new Date().toISOString();
}

export function projectMixRowToHomePreview(row: MixPostRow, activityKey: string): SearchHomeV1PostPreviewWire | null {
  const obj = row as Record<string, unknown>;
  if (!postMatchesMembership(obj, activityKey)) return null;
  const id = String(obj.postId ?? obj.id ?? "").trim();
  if (!id) return null;
  const cover = getBestPostCover(obj);
  const title =
    (typeof obj.title === "string" && obj.title.trim()) ||
    (typeof obj.caption === "string" && obj.caption.trim()) ||
    (typeof obj.description === "string" && obj.description.trim()) ||
    null;
  return {
    id,
    thumbnailUrl: cover.coverImageUrl,
    mediaType: mediaTypeFromRow(obj),
    activity: pickActivityForMix(
      obj,
      activityKey,
      resolveSearchHomeV1MixCanonicalKey(activityKey) ?? normalizeActivityTagForSearchHome(activityKey) ?? activityKey,
    ),
    title,
    placeName: placeNameFromRow(obj),
    createdAt: createdAtIso(obj),
  };
}

export function filterPreviewRowsForActivity(rows: MixPostRow[], activityKey: string, max: number): SearchHomeV1PostPreviewWire[] {
  const out: SearchHomeV1PostPreviewWire[] = [];
  for (const row of rows) {
    const p = projectMixRowToHomePreview(row, activityKey);
    if (p) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
