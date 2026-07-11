import type { AppEnv } from "../../config/env.js";
import {
  downloadInstagramReelFile,
} from "../../lib/instagram-reel/fileCore.js";
import {
  instagramReelProbe,
  resolveInstagramReel,
} from "../../lib/instagram-reel/resolveCore.js";

export type InstagramReelResult =
  | { kind: "json"; status: number; body: string; contentType: string }
  | { kind: "binary"; status: number; body: Buffer; headers: Record<string, string> };

export async function probeInstagramReel(): Promise<InstagramReelResult> {
  return instagramReelProbe() as Promise<InstagramReelResult>;
}

export async function resolveInstagramReelRequest(
  body: unknown,
  opts?: { debug?: boolean; userAgent?: string },
): Promise<InstagramReelResult> {
  return resolveInstagramReel(body, opts) as Promise<InstagramReelResult>;
}

export async function downloadInstagramReelFileRequest(
  body: unknown,
): Promise<InstagramReelResult> {
  return downloadInstagramReelFile(body) as Promise<InstagramReelResult>;
}

export function instagramDownloaderHealth(_env: AppEnv) {
  return {
    ok: true,
    service: "backendv2",
    resolveApi: "/admin/instagram-downloader/api/resolve",
    fileApi: "/admin/instagram-downloader/api/file",
    probeApi: "/admin/instagram-downloader/api/probe",
  };
}
