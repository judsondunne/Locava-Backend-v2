import type { PlaceImageResult } from "../../types/places.js";

/** Hosts that block hotlinking or break in `<img>` tags — reject before ranking. */
const BLOCKED_IMAGE_HOST_PATTERNS = [
  /(^|\.)facebook\.com$/i,
  /(^|\.)fbcdn\.net$/i,
  /(^|\.)fbsbx\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)pinterest\.com$/i,
  /(^|\.)pinimg\.com$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)tiktokcdn\.com$/i,
];

const BLOCKED_IMAGE_URL_PATTERNS = [
  /lookaside\.fbsbx\.com/i,
  /encrypted-tbn0\.gstatic\.com/i,
  /\/safe_image\.php/i,
];

export function isBlockedEmbedHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (BLOCKED_IMAGE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
      return true;
    }
  } catch {
    return true;
  }
  return BLOCKED_IMAGE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

export type ImageLoadProbe = {
  ok: boolean;
  contentType?: string;
  contentLength?: number;
};

async function probeImageUrl(url: string, method: "HEAD" | "GET"): Promise<ImageLoadProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "LocavaPlacesVisualizer/1.0 (+https://locava.app)",
      Accept: "image/*,*/*;q=0.8",
    };
    if (method === "GET") {
      headers.Range = "bytes=0-8191";
    }

    const response = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
      headers,
    });

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") || 0);

    if (!response.ok && response.status !== 206) {
      return { ok: false };
    }

    if (contentType.startsWith("image/")) {
      return { ok: true, contentType, contentLength };
    }

    if (method === "GET" && response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (looksLikeImageMagic(bytes)) {
        return { ok: true, contentType: "image/unknown", contentLength: bytes.length };
      }
    }

    return { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeImageMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true; // jpeg
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return true; // png
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return true; // gif
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return true; // webp (RIFF)
  return false;
}

export async function verifyImageLoads(url: string): Promise<ImageLoadProbe> {
  if (isBlockedEmbedHost(url)) {
    return { ok: false };
  }

  const head = await probeImageUrl(url, "HEAD");
  if (head.ok) return head;

  return probeImageUrl(url, "GET");
}

export async function filterVerifiedLoadableImages(
  results: PlaceImageResult[],
  concurrency = 6,
): Promise<PlaceImageResult[]> {
  const verified: PlaceImageResult[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < results.length) {
      const current = results[index]!;
      index += 1;
      if (isBlockedEmbedHost(current.imageUrl)) continue;
      const probe = await verifyImageLoads(current.imageUrl);
      if (probe.ok) verified.push(current);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, results.length) }, () => worker());
  await Promise.all(workers);
  return verified;
}
