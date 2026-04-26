import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

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
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: () => number }).toMillis === "function") {
    return Math.floor((value as { toMillis: () => number }).toMillis());
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
  return `https://picsum.photos/seed/${encodeURIComponent(postId)}/500/888`;
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

export function mapPostDocToGridPreview(doc: QueryDocumentSnapshot): {
  postId: string;
  thumbUrl: string;
  mediaType: "image" | "video";
  aspectRatio?: number;
  updatedAtMs: number;
  processing?: boolean;
  processingFailed?: boolean;
} {
  const data = doc.data() as Record<string, unknown>;
  const proc = inferPostProcessing(data);
  const ar = readAspectRatio(data);
  return {
    postId: doc.id,
    thumbUrl: readPostThumbUrl(data, doc.id),
    mediaType: inferPostMediaType(data),
    aspectRatio: typeof ar === "number" && ar > 0 ? ar : 9 / 16,
    updatedAtMs: readPostDisplayMillis(data),
    processing: proc.processing,
    processingFailed: proc.processingFailed
  };
}

export function readOrderMillisFromSnapshot(doc: QueryDocumentSnapshot): number {
  const data = doc.data() as Record<string, unknown>;
  const ms = readPostOrderMillis(data);
  return ms > 0 ? ms : readPostDisplayMillis(data);
}
