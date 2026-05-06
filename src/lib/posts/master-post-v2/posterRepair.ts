type UnknownRecord = Record<string, unknown>;

export type PosterRepairReason =
  | "external_expiring_poster"
  | "poster_unreachable"
  | "poster_missing"
  | "poster_non_image"
  | "poster_signed_url_expired"
  | "poster_ok";

export type PosterRepairEvaluation = {
  needsPosterRepair: boolean;
  reason: PosterRepairReason;
  candidatePosterUrls: string[];
  durablePosterUrl?: string;
  affectedPaths: string[];
};

const EXTERNAL_POSTER_HOST_RE = /instagram|fbcdn|cdninstagram|facebook|twimg|tiktokcdn/i;

function rec(v: unknown): UnknownRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as UnknownRecord) : null;
}

function asUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

function parseHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function looksSignedUrl(url: string): boolean {
  try {
    const q = new URL(url).searchParams;
    return (
      q.has("X-Amz-Expires") ||
      q.has("X-Amz-Signature") ||
      q.has("Expires") ||
      q.has("Signature") ||
      q.has("Policy")
    );
  } catch {
    return false;
  }
}

function isDurablePosterHost(host: string, configuredBases: string[]): boolean {
  if (!host) return false;
  if (host.includes("wasabisys.com")) return true;
  return configuredBases.some((base) => {
    const h = parseHost(base);
    return h.length > 0 && host === h;
  });
}

function isExternalHost(host: string): boolean {
  return EXTERNAL_POSTER_HOST_RE.test(host);
}

function collectPosterCandidates(post: UnknownRecord): Array<{ path: string; url: string }> {
  const out: Array<{ path: string; url: string }> = [];
  const media = rec(post.media);
  const cover = rec(media?.cover);
  const compat = rec(post.compatibility);
  const push = (path: string, value: unknown) => {
    const u = asUrl(value);
    if (!u) return;
    out.push({ path, url: u });
  };
  push("media.cover.posterUrl", cover?.posterUrl);
  push("media.cover.url", cover?.url);
  push("media.cover.thumbUrl", cover?.thumbUrl);
  push("compatibility.posterUrl", compat?.posterUrl);
  push("compatibility.photoLink", compat?.photoLink);
  push("compatibility.displayPhotoLink", compat?.displayPhotoLink);
  push("compatibility.thumbUrl", compat?.thumbUrl);
  push("photoLink", post.photoLink);
  push("displayPhotoLink", post.displayPhotoLink);
  push("thumbUrl", post.thumbUrl);
  push("posterUrl", post.posterUrl);
  const mediaAssets = Array.isArray(media?.assets) ? (media!.assets as unknown[]) : [];
  for (let i = 0; i < mediaAssets.length; i += 1) {
    const a = rec(mediaAssets[i]);
    if (!a || a.type !== "video") continue;
    const v = rec(a.video);
    const pb = rec(v?.playback);
    const variants = rec(v?.variants);
    push(`media.assets[${i}].video.playback.posterUrl`, pb?.posterUrl);
    push(`media.assets[${i}].video.variants.poster`, variants?.poster);
    push(`media.assets[${i}].video.posterUrl`, v?.posterUrl);
  }
  return out;
}

export function evaluatePosterRepairNeed(
  post: Record<string, unknown>,
  options?: { configuredPublicBases?: string[] }
): PosterRepairEvaluation {
  const bases = options?.configuredPublicBases ?? [];
  const candidates = collectPosterCandidates(post);
  const candidatePosterUrls = [...new Set(candidates.map((c) => c.url))];
  const mediaKind = String(rec(post.classification)?.mediaKind ?? post.mediaType ?? "")
    .trim()
    .toLowerCase();
  if (mediaKind !== "video" && mediaKind !== "mixed") {
    return {
      needsPosterRepair: false,
      reason: "poster_ok",
      candidatePosterUrls,
      affectedPaths: []
    };
  }
  if (candidatePosterUrls.length === 0) {
    return {
      needsPosterRepair: true,
      reason: "poster_missing",
      candidatePosterUrls,
      affectedPaths: []
    };
  }
  for (const c of candidates) {
    const host = parseHost(c.url);
    const durable = isDurablePosterHost(host, bases);
    const external = isExternalHost(host);
    const signed = looksSignedUrl(c.url);
    if (durable && !signed) {
      return {
        needsPosterRepair: false,
        reason: "poster_ok",
        candidatePosterUrls,
        durablePosterUrl: c.url,
        affectedPaths: []
      };
    }
    if (external && signed) {
      return {
        needsPosterRepair: true,
        reason: "poster_signed_url_expired",
        candidatePosterUrls,
        affectedPaths: [c.path]
      };
    }
    if (external) {
      return {
        needsPosterRepair: true,
        reason: "external_expiring_poster",
        candidatePosterUrls,
        affectedPaths: [c.path]
      };
    }
    if (!durable && signed) {
      return {
        needsPosterRepair: true,
        reason: "poster_signed_url_expired",
        candidatePosterUrls,
        affectedPaths: [c.path]
      };
    }
    if (!durable) {
      return {
        needsPosterRepair: false,
        reason: "poster_ok",
        candidatePosterUrls,
        durablePosterUrl: c.url,
        affectedPaths: []
      };
    }
  }
  return {
    needsPosterRepair: false,
    reason: "poster_ok",
    candidatePosterUrls,
    affectedPaths: []
  };
}
