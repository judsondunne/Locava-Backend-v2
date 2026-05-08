#!/usr/bin/env npx tsx
/**
 * Read-only audit: print media fields for one post from local Backendv2 feed or details.
 * Usage: LOCAVA_BACKEND_BASE=http://127.0.0.1:8080 VIEWER_UID=yourUid npx tsx scripts/read-only-audit-feed-post-wire.mts postIdHere
 */

const base = process.env.LOCAVA_BACKEND_BASE ?? "http://127.0.0.1:8080";
const viewerId = process.env.VIEWER_UID ?? "anonymous";
const postId = process.argv[2];
if (!postId) {
  console.error("usage: VIEWER_UID=... npx tsx scripts/read-only-audit-feed-post-wire.mts <postId>");
  process.exit(1);
}

async function main() {
  const headers: Record<string, string> = { "x-viewer-id": viewerId, "content-type": "application/json" };
  const token = process.env.ID_TOKEN ?? process.env.ID_TOKEN_PREVIEW;
  if (token) headers.authorization = `Bearer ${token}`;
  let card: Record<string, unknown> | undefined;
  const feed = await fetch(`${base}/v2/feed/for-you/simple?limit=12`, { headers });
  if (feed.ok) {
    const j = await feed.json();
    const items = (((j?.data ?? j)?.items ?? j?.items ?? []) as unknown[]) || [];
    card = items.find((row) => (row as { postId?: string })?.postId === postId) as Record<string, unknown> | undefined;
  }
  if (!card) {
    const bat = await fetch(`${base}/v2/posts/details:batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        postIds: [postId],
        reason: "open",
        hydrationMode: "playback",
        mode: "playback_prefetch_compact",
      }),
    });
    if (bat.ok) {
      const bj = await bat.json();
      const found = ((((bj?.data ?? bj)?.found ?? []) as unknown[]) || []) as Array<{ postId?: string; detail?: unknown }>;
      card = found.find((r) => r.postId === postId) as Record<string, unknown> | undefined;
      if ((found[0]?.detail as { firstRender?: { post?: unknown } })?.firstRender) {
        console.log("detail.firstRender present:", Object.keys(found[0] ?? {}));
      }
    }
  }
  console.log(JSON.stringify({ postId, foundVia: card ? "feed_or_batch" : "missing", preview: summarize(card) }, null, 2));
}

function summarize(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) return {};
  const ap = (row.appPostV2 ?? row.appPost ?? row.post) as Record<string, unknown> | undefined;
  const media = ap?.media as { assets?: unknown[] } | undefined;
  const assets = Array.isArray(media?.assets) ? media.assets : [];
  const first = (assets[0] ?? {}) as Record<string, unknown>;
  const img = (first.image ?? {}) as Record<string, unknown>;
  const compatibility = row.compatibility as Record<string, unknown> | undefined;
  return {
    mediaAssetsLen: assets.length,
    imageDisplayUrl: img.displayUrl ?? null,
    imagePreviewUrl: img.previewUrl ?? null,
    imageOriginalUrl: img.originalUrl ?? null,
    coverPoster: row.media && typeof row.media === "object" ? (row.media as { posterUrl?: string }).posterUrl : null,
    displayPhotoLink: row.displayPhotoLink ?? compatibility?.displayPhotoLink,
    playbackUrl: row.playbackUrl ?? null,
    selectedAssetId: first.id ?? null,
  };
}

void main();
