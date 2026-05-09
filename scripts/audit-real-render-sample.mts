/**
 * audit-real-render-sample — READ-ONLY Firestore sample + render-shape audit.
 *
 *   cd "Locava Backendv2"
 *   npx tsx scripts/audit-real-render-sample.mts
 *
 * Env:
 *   POST_IDS=id1,id2   — exact post ids (max 100)
 *   USER_ID=uid        — union with that user's recent posts (posts where userId==USER_ID)
 *   AUDIT_BASE_URL     — optional http://127.0.0.1:8083 to GET feed/profile bootstrap for shape compare
 *
 * GUARDRAILS: This script must never call set/update/delete/batch.write/commit on Firestore.
 * Only: collection().doc().get(), collection().where().limit().get(), collection().orderBy().limit().get()
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { StandardizedPostDoc } from "../src/contracts/standardized-post-doc.contract.js";
import { standardizePostDocForRender } from "../src/services/posts/standardize-post-doc-for-render.js";
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";

const OUT_MD = resolve(dirname(fileURLToPath(import.meta.url)), "..", "real-render-sample-audit.md");
const OUT_JSON = resolve(dirname(fileURLToPath(import.meta.url)), "..", "real-render-sample-audit.json");

/** Hard fail if production write APIs appear in this file (lightweight static guard). */
const THIS_FILE = fileURLToPath(import.meta.url);
function assertReadOnlyScriptSource(): void {
  const src = readFileSync(THIS_FILE, "utf8");
  const banned = [/\.set\(/, /\.update\(/, /runTransaction/, /writeBatch/];
  for (const re of banned) {
    if (re.test(src)) {
      throw new Error(`audit-real-render-sample.mts must stay read-only; matched ${re}`);
    }
  }
}
assertReadOnlyScriptSource();

type RawShape =
  | "full_root_standardized"
  | "partial_root"
  | "appPostV2"
  | "feed_card"
  | "legacy"
  | "unknown";

type Row = {
  postId: string;
  rawShape: RawShape;
  sectionsPresent: string[];
  rawMediaAssetsCount: number;
  extractedMediaAssetsCount: number;
  outputModelMediaAssetsCount: number;
  videoAssetCount: number;
  imageAssetCount: number;
  hasPlayableVideoUrl: boolean;
  selectedVideoUriKind: string;
  hasPoster: boolean;
  titlePresent: boolean;
  titleSource: string;
  authorPresent: boolean;
  authorSource: string;
  locationPresent: boolean;
  locationSource: string;
  engagementPresent: boolean;
  engagementSource: string;
  hasLetterboxGradient: boolean;
  hasLegacyAssetId: boolean;
  wouldBeOpenable: boolean;
  modelQuality: string;
  blockers: string[];
  warnings: string[];
};

const SECTIONS = [
  "author",
  "classification",
  "compatibility",
  "engagement",
  "engagementPreview",
  "lifecycle",
  "location",
  "media",
  "ranking",
  "schema",
  "text",
] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function nonEmpty(s: unknown): string | null {
  return typeof s === "string" && s.trim().length > 0 ? s.trim() : null;
}

function classifyRawShape(data: Record<string, unknown>): RawShape {
  const has = (k: string) => data[k] != null;
  if (has("schema") && has("lifecycle") && has("media") && has("author") && has("text")) {
    return "full_root_standardized";
  }
  if (has("media") && has("appPostV2")) return "appPostV2";
  if (has("appPostV2")) return "appPostV2";
  if (has("media") && Array.isArray((asRecord(data.media)?.assets as unknown[]) ?? [])) {
    const n = (asRecord(data.media)?.assets as unknown[])?.length ?? 0;
    if (n > 0 && !has("schema")) return "partial_root";
  }
  if (has("compatibility") && (data.assets || data.photoLink)) return "feed_card";
  if (data.assets || data.photoLink || data.displayPhotoLink) return "legacy";
  return "unknown";
}

function sectionsPresent(data: Record<string, unknown>): string[] {
  return SECTIONS.filter((s) => data[s] != null);
}

function compactUriKind(uri: string | null): string {
  if (!uri) return "missing";
  const u = uri.toLowerCase();
  if (u.includes("startup720")) return "startup720_faststart_avc";
  if (u.endsWith(".m3u8") || u.includes(".m3u8")) return "hls";
  if (u.endsWith(".mp4")) return "mp4";
  return "other";
}

function firstPlayableVideoUri(doc: StandardizedPostDoc): { uri: string | null; kind: string } {
  const assets = doc.media?.assets ?? [];
  for (const a of assets) {
    if (a.type !== "video") continue;
    const playback = a.video?.playback;
    const candidates = [
      playback?.startupUrl,
      playback?.primaryUrl,
      playback?.defaultUrl,
      playback?.goodNetworkUrl,
      playback?.fallbackUrl,
      a.video?.originalUrl,
    ].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    const uri = candidates[0] ?? null;
    return { uri, kind: compactUriKind(uri) };
  }
  return { uri: null, kind: "missing" };
}

function analyzeRow(postId: string, raw: Record<string, unknown>): Row {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const candidate = { ...raw, id: nonEmpty(raw.id) ?? postId, postId: nonEmpty(raw.postId) ?? postId };
  const std = standardizePostDocForRender(candidate as unknown as StandardizedPostDoc);
  const rawShape = classifyRawShape(raw);
  const rawMediaCount = Array.isArray(asRecord(raw.media)?.assets)
    ? (asRecord(raw.media)!.assets as unknown[]).length
    : 0;

  if (!std.ok) {
    blockers.push(`standardize_failed:${std.reason}`);
    return {
      postId,
      rawShape,
      sectionsPresent: sectionsPresent(raw),
      rawMediaAssetsCount: rawMediaCount,
      extractedMediaAssetsCount: 0,
      outputModelMediaAssetsCount: 0,
      videoAssetCount: 0,
      imageAssetCount: 0,
      hasPlayableVideoUrl: false,
      selectedVideoUriKind: "missing",
      hasPoster: false,
      titlePresent: false,
      titleSource: "n/a",
      authorPresent: false,
      authorSource: "n/a",
      locationPresent: false,
      locationSource: "n/a",
      engagementPresent: false,
      engagementSource: "n/a",
      hasLetterboxGradient: false,
      hasLegacyAssetId: false,
      wouldBeOpenable: false,
      modelQuality: "rejected",
      blockers,
      warnings,
    };
  }

  const doc = std.doc;
  const assets = doc.media?.assets ?? [];
  let videoAssetCount = 0;
  let imageAssetCount = 0;
  let hasLegacyAssetId = false;
  let hasLetterboxGradient = false;
  for (const a of assets) {
    if (a.type === "video") videoAssetCount += 1;
    if (a.type === "image") imageAssetCount += 1;
    if (typeof a.id === "string" && /^legacy_/i.test(a.id)) hasLegacyAssetId = true;
    const pres = asRecord((a as { presentation?: unknown }).presentation);
    const lg = asRecord(pres?.letterboxGradient as unknown);
    if (nonEmpty(lg?.top) && nonEmpty(lg?.bottom)) hasLetterboxGradient = true;
  }
  const { uri: vidUri, kind: selectedVideoUriKind } = firstPlayableVideoUri(doc);
  const hasPlayableVideoUrl = typeof vidUri === "string" && vidUri.length > 0;
  const coverUrl = nonEmpty(doc.media?.cover?.url);
  const firstVid = assets.find((x) => x.type === "video");
  const poster =
    nonEmpty(firstVid?.video?.posterHighUrl) ??
    nonEmpty(firstVid?.video?.posterUrl) ??
    nonEmpty(firstVid?.video?.thumbnailUrl);
  const hasPoster = Boolean(coverUrl || poster);

  const text = doc.text;
  const titlePresent =
    Boolean(nonEmpty(doc.title)) ||
    Boolean(nonEmpty(text?.title)) ||
    Boolean(nonEmpty(text?.caption)) ||
    Boolean(nonEmpty(text?.content));
  const authorPresent = Boolean(nonEmpty(doc.author?.userId));
  const locationPresent =
    doc.location?.coordinates != null &&
    typeof doc.location.coordinates.lat === "number" &&
    typeof doc.location.coordinates.lng === "number" &&
    !(doc.location.coordinates.lat === 0 && doc.location.coordinates.lng === 0);
  const engagementPresent =
    (typeof doc.engagement?.likeCount === "number" && doc.engagement.likeCount > 0) ||
    (typeof doc.engagement?.commentCount === "number" && doc.engagement.commentCount > 0);

  const wouldBeOpenable =
    assets.some((a) => {
      if (a.type === "image") {
        return Boolean(nonEmpty(a.image?.displayUrl) || nonEmpty(a.image?.originalUrl));
      }
      if (a.type === "video") {
        return hasPlayableVideoUrl;
      }
      return false;
    }) && assets.length > 0;

  let modelQuality = "unknown";
  if (rawShape === "full_root_standardized" && !hasLegacyAssetId) modelQuality = "full_canonical";
  else if (rawShape === "appPostV2") modelQuality = "appPostV2_envelope";
  else if (rawShape === "partial_root") modelQuality = "partial_root_envelope";
  else if (rawShape === "feed_card") modelQuality = "feed_card_envelope";
  else if (rawShape === "legacy") modelQuality = "compatibility_fallback";

  if (videoAssetCount > 0 && !hasPlayableVideoUrl) {
    blockers.push("video_assets_but_no_playable_url");
  }
  if (rawMediaCount > 0 && assets.length < rawMediaCount) {
    blockers.push(`asset_count_shrink:${rawMediaCount}->${assets.length}`);
  }

  return {
    postId,
    rawShape,
    sectionsPresent: sectionsPresent(raw),
    rawMediaAssetsCount: rawMediaCount,
    extractedMediaAssetsCount: assets.length,
    outputModelMediaAssetsCount: assets.length,
    videoAssetCount,
    imageAssetCount,
    hasPlayableVideoUrl,
    selectedVideoUriKind,
    hasPoster,
    titlePresent,
    titleSource: nonEmpty(text?.title) ? "text.title" : nonEmpty(doc.title) ? "doc.title" : "derived",
    authorPresent,
    authorSource: authorPresent ? "author.userId" : "missing",
    locationPresent,
    locationSource: locationPresent ? "location" : "missing",
    engagementPresent,
    engagementSource: engagementPresent ? "engagement" : "missing",
    hasLetterboxGradient,
    hasLegacyAssetId,
    wouldBeOpenable,
    modelQuality,
    blockers,
    warnings,
  };
}

function parseEnvIds(): { postIds: string[]; userId: string | null } {
  const postIds = (process.env.POST_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
  const userId = (process.env.USER_ID ?? "").trim() || null;
  return { postIds, userId };
}

async function fetchOptionalHttpCompare(baseUrl: string, userId: string | null): Promise<unknown> {
  const out: Record<string, unknown> = {};
  try {
    const fy = await fetch(`${baseUrl}/v2/feed/for-you/simple`);
    out.forYouSimple = { status: fy.status, ok: fy.ok };
  } catch (e) {
    out.forYouSimple = { error: String(e) };
  }
  if (userId) {
    try {
      const boot = await fetch(`${baseUrl}/v2/profiles/${encodeURIComponent(userId)}/bootstrap`);
      out.profileBootstrap = { status: boot.status, ok: boot.ok };
    } catch (e) {
      out.profileBootstrap = { error: String(e) };
    }
  }
  return out;
}

async function main(): Promise<void> {
  const db = getFirestoreSourceClient();
  if (!db) {
    throw new Error("Firestore unavailable (configure source client / FIRESTORE_SOURCE_ENABLED).");
  }

  const { postIds: envPostIds, userId } = parseEnvIds();
  const idSet = new Set<string>(envPostIds);

  if (userId) {
    const q = db.collection("posts").where("userId", "==", userId).limit(100);
    const snap = await q.get();
    for (const d of snap.docs) idSet.add(d.id);
  }

  if (idSet.size === 0) {
    let snap;
    try {
      snap = await db.collection("posts").orderBy("createdAt", "desc").limit(100).get();
    } catch {
      snap = await db.collection("posts").limit(100).get();
    }
    for (const d of snap.docs) idSet.add(d.id);
  }

  const ids = [...idSet].slice(0, 100);
  const rows: Row[] = [];
  for (const postId of ids) {
    const docRef = db.collection("posts").doc(postId);
    const snap = await docRef.get();
    if (!snap.exists) continue;
    const data = snap.data() as Record<string, unknown>;
    rows.push(analyzeRow(postId, data));
  }

  const httpCompare =
    process.env.AUDIT_BASE_URL != null && process.env.AUDIT_BASE_URL.length > 0
      ? await fetchOptionalHttpCompare(process.env.AUDIT_BASE_URL, userId)
      : null;

  const failures: string[] = [];
  for (const r of rows) {
    for (const b of r.blockers) failures.push(`${r.postId}:${b}`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    sampled: rows.length,
    httpCompare,
    rows,
    failures,
    failed: failures.length > 0,
  };

  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  const md: string[] = [];
  md.push("# Real render sample audit");
  md.push("");
  md.push("Read-only. Generated by `scripts/audit-real-render-sample.mts`.");
  md.push("");
  md.push(`- sampled: ${rows.length}`);
  md.push(`- failures: ${failures.length}`);
  md.push("");
  for (const r of rows) {
    md.push(`## ${r.postId}`);
    md.push(`- rawShape: ${r.rawShape}`);
    md.push(`- modelQuality: ${r.modelQuality}`);
    md.push(`- media: raw=${r.rawMediaAssetsCount} out=${r.outputModelMediaAssetsCount} video=${r.videoAssetCount}`);
    md.push(`- video: playable=${r.hasPlayableVideoUrl} kind=${r.selectedVideoUriKind}`);
    md.push(`- title/author: ${r.titlePresent}/${r.authorPresent}`);
    if (r.blockers.length) md.push(`- **blockers**: ${r.blockers.join("; ")}`);
    if (r.warnings.length) md.push(`- warnings: ${r.warnings.join("; ")}`);
    md.push("");
  }
  writeFileSync(OUT_MD, md.join("\n"), "utf8");

  console.log(JSON.stringify({ ok: failures.length === 0, sampled: rows.length, failures: failures.length, outMd: OUT_MD, outJson: OUT_JSON }));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
