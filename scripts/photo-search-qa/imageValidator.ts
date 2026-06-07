import type { PlaceImageApiResult } from "./types.js";

export const MIN_IMAGE_BYTES = 2048;

export type ImageFetchProbe = {
  httpStatus: number | null;
  contentType: string | null;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  loadMs: number;
  bytes: Uint8Array | null;
  loadsOk: boolean;
};

export function normalizeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const stripParams = ["w", "h", "width", "height", "q", "quality", "fit", "crop", "auto", "format"];
    for (const key of [...parsed.searchParams.keys()]) {
      if (stripParams.includes(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function parseImageDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
    const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
    return { width, height };
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      if (marker === 0xc0 || marker === 0xc2) {
        const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
        const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
        return { width, height };
      }
      offset += 2 + length;
    }
  }

  return { width: null, height: null };
}

function looksLikeImageMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return true;
  return false;
}

export async function probeImageUrl(url: string, timeoutMs = 8000): Promise<ImageFetchProbe> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "User-Agent": "LocavaPhotoSearchQA/1.0",
      Accept: "image/*,*/*;q=0.8",
      Range: "bytes=0-65535",
    };

    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers,
    });

    const loadMs = Math.round(performance.now() - started);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentLengthHeader = Number(response.headers.get("content-length") || 0);

    if (!response.ok && response.status !== 206) {
      return {
        httpStatus: response.status,
        contentType,
        byteSize: null,
        width: null,
        height: null,
        loadMs,
        bytes: null,
        loadsOk: false,
      };
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
    const byteSize = contentLengthHeader > 0 ? contentLengthHeader : buffer.length;
    const dims = parseImageDimensions(buffer);
    const isImage = contentType.startsWith("image/") || looksLikeImageMagic(buffer);
    const loadsOk = isImage && byteSize >= MIN_IMAGE_BYTES;

    return {
      httpStatus: response.status,
      contentType: isImage ? contentType || "image/unknown" : contentType,
      byteSize,
      width: dims.width,
      height: dims.height,
      loadMs,
      bytes: buffer,
      loadsOk,
    };
  } catch {
    return {
      httpStatus: null,
      contentType: null,
      byteSize: null,
      width: null,
      height: null,
      loadMs: Math.round(performance.now() - started),
      bytes: null,
      loadsOk: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeSourcePage(url: string, timeoutMs = 6000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "LocavaPhotoSearchQA/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (response.ok) return true;
    const getResponse = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "LocavaPhotoSearchQA/1.0",
        Accept: "text/html,application/xhtml+xml",
        Range: "bytes=0-2047",
      },
    });
    return getResponse.ok || getResponse.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function validateImageMetadata(result: PlaceImageApiResult): {
  metadataOk: boolean;
  missingMetadataFields: string[];
} {
  const missing: string[] = [];
  if (!result.sourceUrl?.trim()) missing.push("sourceUrl");
  if (!result.sourceName?.trim()) missing.push("sourceName");
  if (!result.caption?.trim() && !result.title?.trim()) missing.push("title/caption");
  if (!result.sourceDomain?.trim()) missing.push("sourceDomain");
  if (!result.provider) missing.push("provider");
  if (!result.backlinkUrl?.trim()) missing.push("backlinkUrl");
  if (!result.licenseNote?.trim()) missing.push("licenseNote");
  if (!result.copyrightDisclaimer?.trim()) missing.push("copyrightDisclaimer");

  return { metadataOk: missing.length === 0, missingMetadataFields: missing };
}
