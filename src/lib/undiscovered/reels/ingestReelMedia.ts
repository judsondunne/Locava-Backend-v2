import { resolveInstagramPublicGraphql } from "../../instagram-reel/instagramGraphqlResolve.js";
import { readWasabiConfigFromEnv } from "../../../services/storage/wasabi-config.js";
import { uploadFileToWasabiKey } from "../../../services/video/wasabi-upload-file.js";

/**
 * Reel media ingest: turn a link-only reel into a playable one.
 *
 * Resolves Instagram's CDN video + poster for a shortcode, downloads them, and
 * re-hosts them on Wasabi so the app serves stable URLs (IG CDN links expire and
 * aren't embeddable). Returns the hosted `videoUrl` + `thumbnailUrl` to write
 * back onto the undiscoveredReels doc — enriching it, not replacing anything.
 *
 * NOTE: re-hosting creators' videos is a product/IP decision. This module is the
 * mechanism; the runner that calls it at scale should only run once that call is
 * made (and with attribution preserved, which the doc already carries).
 *
 * All I/O is injectable so the orchestration is unit-testable without network.
 */

export type ReelMediaDeps = {
  /** Resolve IG CDN media for a shortcode. Returns null when unresolvable. */
  resolveMedia: (shortcode: string) => Promise<{ videoUrl?: string | null; thumbnailUrl?: string | null } | null>;
  /** Download a URL to a local temp file; returns its path. */
  downloadToTmp: (url: string, ext: string) => Promise<string>;
  /** Upload a local file to a Wasabi key; returns its public URL. */
  uploadFile: (localPath: string, key: string, contentType: string) => Promise<{ publicUrl: string }>;
  /** Remove temp files (best-effort). */
  cleanup?: (paths: string[]) => Promise<void>;
  /** Key prefix for hosted objects. */
  keyPrefix?: string;
};

export type IngestedReelMedia = { videoUrl: string; thumbnailUrl: string | null };

/** Resolve → download → re-host a reel's video (and poster). Null when no video is resolvable. */
export async function ingestReelMedia(shortcode: string, deps: ReelMediaDeps): Promise<IngestedReelMedia | null> {
  const prefix = (deps.keyPrefix ?? "undiscovered-reels").replace(/\/+$/, "");
  const media = await deps.resolveMedia(shortcode);
  if (!media?.videoUrl) return null;

  const tmpPaths: string[] = [];
  try {
    const videoTmp = await deps.downloadToTmp(media.videoUrl, "mp4");
    tmpPaths.push(videoTmp);
    const { publicUrl: videoUrl } = await deps.uploadFile(videoTmp, `${prefix}/${shortcode}/video.mp4`, "video/mp4");

    let thumbnailUrl: string | null = null;
    if (media.thumbnailUrl) {
      try {
        const thumbTmp = await deps.downloadToTmp(media.thumbnailUrl, "jpg");
        tmpPaths.push(thumbTmp);
        thumbnailUrl = (await deps.uploadFile(thumbTmp, `${prefix}/${shortcode}/poster.jpg`, "image/jpeg")).publicUrl;
      } catch {
        // poster is best-effort — a playable video without a poster is still fine
      }
    }
    return { videoUrl, thumbnailUrl };
  } finally {
    if (tmpPaths.length) await deps.cleanup?.(tmpPaths);
  }
}

/**
 * Wire the real IG resolver + HTTP download + Wasabi upload. Returns null when
 * Wasabi isn't configured (so callers can fail loudly instead of silently).
 */
export function createDefaultReelMediaDeps(opts: { cookieHeader?: string; keyPrefix?: string } = {}): ReelMediaDeps | null {
  const cfg = readWasabiConfigFromEnv();
  if (!cfg) return null;
  return {
    keyPrefix: opts.keyPrefix,
    resolveMedia: async (shortcode) => {
      const r = await resolveInstagramPublicGraphql(shortcode, [], { extraCookieHeader: opts.cookieHeader ?? null });
      return r ? { videoUrl: r.videoUrl ?? null, thumbnailUrl: r.thumbnailUrl ?? null } : null;
    },
    downloadToTmp: async (url, ext) => {
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { writeFile } = await import("node:fs/promises");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download_${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const path = join(tmpdir(), `reel-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
      await writeFile(path, buf);
      return path;
    },
    uploadFile: async (localPath, key, contentType) => {
      const { publicUrl } = await uploadFileToWasabiKey({ cfg, localPath, key, contentType });
      return { publicUrl };
    },
    cleanup: async (paths) => {
      const { unlink } = await import("node:fs/promises");
      await Promise.all(paths.map((p) => unlink(p).catch(() => undefined)));
    },
  };
}
