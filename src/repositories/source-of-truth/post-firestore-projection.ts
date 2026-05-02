import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { normalizeCanonicalPostLocation } from "../../lib/location/post-location-normalizer.js";

/**
 * Maps legacy / normalized Backendv2 projection fields and real Locava post documents
 * (see sampled production: `time`, `displayPhotoLink`, `likesCount`, etc.).
 */

export function readPostOrderMillis(data: Record<string, unknown>): number {
  const candidates = [data.time, data.lastUpdated, data.updatedAt, data.createdAtMs];
  for (const c of candidates) {
    const ms = readMaybeMillis(c);
    if (ms !== null) return ms;
  }
  return 0;
}

export function readPostDisplayMillis(data: Record<string, unknown>): number {
  const ms = readMaybeMillis(data.updatedAtMs ?? data.lastUpdated ?? data.updatedAt ?? data.time ?? data.createdAtMs);
  return ms ?? Date.now();
}

export function readMaybeMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value > 10_000_000_000 ? value : value * 1000;
    return Math.floor(normalized);
  }
  if (value && typeof value === "object") {
    if ("toMillis" in value && typeof (value as { toMillis: () => number }).toMillis === "function") {
      return Math.floor((value as { toMillis: () => number }).toMillis());
    }
    const seconds =
      typeof (value as { seconds?: unknown }).seconds === "number"
        ? (value as { seconds: number }).seconds
        : typeof (value as { _seconds?: unknown })._seconds === "number"
          ? (value as { _seconds: number })._seconds
          : null;
    if (seconds !== null && Number.isFinite(seconds)) {
      return Math.floor(seconds * 1000);
    }
  }
  return null;
}

export function readPostThumbUrl(data: Record<string, unknown>, postId: string): string {
  const direct = data.displayPhotoLink ?? data.photoLink ?? data.thumbUrl;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const assets = data.assets;
  if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {
    const a0 = assets[0] as { downloadURL?: string; url?: string; poster?: string };
    const u = a0.downloadURL ?? a0.url ?? a0.poster;
    if (typeof u === "string" && u.trim()) return u.trim();
  }
  void postId;
  return "";
}

export function inferPostMediaType(data: Record<string, unknown>): "image" | "video" {
  if (data.mediaType === "video") return "video";
  if (data.mediaType === "image") return "image";
  const assets = data.assets;
  if (Array.isArray(assets) && assets[0] && typeof assets[0] === "object") {
    const t = (assets[0] as { type?: string }).type;
    if (t === "video") return "video";
  }
  return "image";
}

export function inferPostProcessing(data: Record<string, unknown>): { processing: boolean; processingFailed: boolean } {
  const status = data.imageProcessingStatus;
  if (typeof status === "string") {
    const s = status.toLowerCase();
    if (s.includes("fail") || s.includes("error")) return { processing: false, processingFailed: true };
    if (s === "complete" || s === "ready" || s === "done") return { processing: false, processingFailed: false };
    if (s === "pending" || s === "processing" || s === "running") return { processing: true, processingFailed: false };
  }
  if (data.assetsReady === false) return { processing: true, processingFailed: false };
  return { processing: Boolean(data.processing), processingFailed: Boolean(data.processingFailed) };
}

export function readAspectRatio(data: Record<string, unknown>): number | undefined {
  const ar = data.aspectRatio;
  if (typeof ar === "number" && ar > 0) return ar;
  return undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
  return items.length > 0 ? items : undefined;
}

export function mapPostDocToGridPreview(doc: QueryDocumentSnapshot): {
  postId: string;
  thumbUrl: string;
  mediaType: "image" | "video";
  aspectRatio?: number;
  width?: number;
  height?: number;
  dominantColor?: string;
  dominantGradient?: string[];
  title?: string;
  locationLabel?: string;
  updatedAtMs: number;
  processing?: boolean;
  processingFailed?: boolean;
} {
  const data = doc.data() as Record<string, unknown>;
  const proc = inferPostProcessing(data);
  const ar = readAspectRatio(data);
  const normalizedLocation = normalizeCanonicalPostLocation({
    latitude: data.lat ?? data.latitude,
    longitude: data.long ?? data.lng ?? data.longitude,
    addressDisplayName: data.address ?? data.addressDisplayName ?? data.locationDisplayName,
    city: (data.geoData as Record<string, unknown> | undefined)?.city ?? data.city,
    region: (data.geoData as Record<string, unknown> | undefined)?.state ?? data.state ?? data.region,
    country: (data.geoData as Record<string, unknown> | undefined)?.country ?? data.country,
    source: data.locationSource ?? "unknown",
    reverseGeocodeMatched: data.reverseGeocodeStatus === "resolved"
  });
  return {
    postId: doc.id,
    thumbUrl: readPostThumbUrl(data, doc.id),
    mediaType: inferPostMediaType(data),
    aspectRatio: typeof ar === "number" && ar > 0 ? ar : 9 / 16,
    width: readPositiveNumber(data.width),
    height: readPositiveNumber(data.height),
    dominantColor: readString(data.dominantColor ?? data.primaryColor ?? data.thumbDominantColor),
    dominantGradient: readStringArray(data.dominantGradient ?? data.thumbGradient),
    title: readString(data.title ?? data.captionTitle ?? data.placeName),
    locationLabel:
      readString(data.locationLabel ?? data.placeName ?? data.address) ??
      normalizedLocation.locationDisplayName ??
      "Unknown location",
    updatedAtMs: readPostDisplayMillis(data),
    processing: proc.processing,
    processingFailed: proc.processingFailed,
  };
}

export function readOrderMillisFromSnapshot(doc: QueryDocumentSnapshot): number {
  const data = doc.data() as Record<string, unknown>;
  const ms = readPostOrderMillis(data);
  return ms > 0 ? ms : readPostDisplayMillis(data);
}
