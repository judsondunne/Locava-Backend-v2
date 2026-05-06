#!/usr/bin/env node

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" ? (value as JsonRecord) : null;
}

function readHeader(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function main(): Promise<void> {
  const baseUrl = process.env.BACKENDV2_BASE_URL?.trim() || "http://localhost:3000";
  const profileUserId = process.env.PROFILE_USER_ID?.trim() || "google_112737304177266015450";
  const postId = process.env.POST_ID?.trim() || "4OBl6k8hDn9ZdE2IYPyP";
  const url = `${baseUrl}/v2/profiles/${encodeURIComponent(profileUserId)}/grid?limit=24`;
  const headers: Record<string, string> = { accept: "application/json" };
  const viewerId = readHeader("VIEWER_ID");
  const idToken = readHeader("ID_TOKEN");
  if (viewerId) headers["x-viewer-id"] = viewerId;
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  const res = await fetch(url, { method: "GET", headers });
  assert(res.ok, `request_failed status=${res.status} url=${url}`);
  const payload = (await res.json()) as JsonRecord;
  const data = asRecord(payload.data) ?? payload;
  const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
  const post = items.find((row) => asRecord(row)?.postId === postId);
  assert(post, `post_not_found postId=${postId}`);
  const row = asRecord(post)!;
  const appPostV2 = asRecord(row.appPostV2);
  assert(appPostV2, "missing_appPostV2");
  const media = asRecord(appPostV2.media);
  const assets = Array.isArray(media?.assets) ? (media!.assets as unknown[]) : [];
  assert(assets.length > 0, "missing_media_assets");
  const first = asRecord(assets[0]);
  assert(first?.id === "video_c21a3969bc_0", "first_asset_id_mismatch");
  assert(first?.type === "video", "first_asset_type_not_video");
  const video = asRecord(first?.video);
  const playback = asRecord(video?.playback);
  assert(typeof playback?.startupUrl === "string" && playback.startupUrl.length > 0, "missing_startupUrl");
  assert(typeof playback?.primaryUrl === "string" && playback.primaryUrl.length > 0, "missing_primaryUrl");
  const posterUrl = typeof video?.posterUrl === "string" ? video.posterUrl : asRecord(media?.cover)?.posterUrl;
  assert(typeof posterUrl === "string" && posterUrl.length > 0, "missing_poster_url");
  const gradient = asRecord(asRecord(first?.presentation)?.letterboxGradient);
  assert(gradient?.top === "#5d9ffa", "gradient_top_mismatch");
  assert(gradient?.bottom === "#425400", "gradient_bottom_mismatch");

  console.log(
    JSON.stringify(
      {
        ok: true,
        route: `/v2/profiles/${profileUserId}/grid`,
        postId,
        firstAssetId: first?.id,
        firstAssetType: first?.type,
        startupUrl: playback?.startupUrl,
        primaryUrl: playback?.primaryUrl,
        posterUrl,
        gradient,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[check-profile-single-video] failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
