type Loose = Record<string, unknown>;

function asLoose(v: unknown): Loose | null {
  return v && typeof v === "object" ? (v as Loose) : null;
}

function slimImageBlock(img: Loose | null): Loose | null {
  if (!img) return null;
  const next: Loose = {};
  const keys = [
    "displayUrl",
    "previewUrl",
    "thumbnailUrl",
    "mediumUrl",
    "largeUrl",
    "fullUrl",
    "originalUrl",
    "highQualityUrl",
    "width",
    "height",
    "aspectRatio"
  ];
  for (const k of keys) {
    if (typeof img[k] === "string") next[k] = img[k];
    else if (typeof img[k] === "number") next[k] = img[k];
  }
  return Object.keys(next).length > 0 ? next : null;
}

function slimVideoPlayback(pb: Loose | null): Loose | null {
  if (!pb) return null;
  const keys = [
    "startupUrl",
    "defaultUrl",
    "primaryUrl",
    "poorNetworkUrl",
    "weakNetworkUrl",
    "selectedReason",
    "posterUrl",
    "preferredStartupUri",
  ];
  const next: Loose = {};
  for (const k of keys) {
    if (typeof pb[k] === "string") next[k] = pb[k];
  }
  return Object.keys(next).length > 0 ? next : null;
}

function slimVideoBlock(vid: Loose | null): Loose | null {
  if (!vid) return null;
  const pb = slimVideoPlayback(asLoose(vid.playback));
  const poster =
    typeof vid.posterUrl === "string"
      ? vid.posterUrl
      : typeof vid.poster === "string"
        ? vid.poster
        : null;
  const next: Loose = {};
  if (pb) next.playback = pb;
  if (poster != null && poster.trim()) next.posterUrl = poster.trim();
  return Object.keys(next).length > 0 ? next : null;
}

/** Drop Wasabi-heavy maps and bulky nested payloads while preserving V3 first-render semantics. */
function slimCanonicalMediaAsset(asset: unknown): Loose | null {
  const a = asLoose(asset);
  if (!a) return null;
  const id = typeof a.id === "string" ? a.id.trim() : null;
  const type = typeof a.type === "string" ? a.type.trim().toLowerCase() : "image";
  const out: Loose = { type };
  if (id) out.id = id;
  const pres = asLoose(a.presentation);
  const lgRaw = pres ? asLoose(pres.letterboxGradient) ?? asLoose(asLoose(pres.surface)?.letterboxGradient) : null;
  const top = typeof lgRaw?.top === "string" ? lgRaw.top.trim() : "";
  const bottom = typeof lgRaw?.bottom === "string" ? lgRaw.bottom.trim() : "";
  if (top || bottom) {
    out.presentation = {
      letterboxGradient: {
        ...(top ? { top } : {}),
        ...(bottom ? { bottom } : {})
      }
    };
  }
  if (type === "image") {
    const slim = slimImageBlock(asLoose(a.image));
    if (slim) out.image = slim;
  } else if (type === "video") {
    const slimV = slimVideoBlock(asLoose(a.video));
    if (slimV) out.video = slimV;
    const pv = slimImageBlock(asLoose(a.preview));
    if (pv) out.preview = pv;
  }
  return out;
}

/**
 * Narrow AppPost-ish record shipped on wire for feed/profile grid thumbnails.
 */
export function slimAppPostRecordForCompactWire(
  post: Loose | null | undefined,
  opts?: { maxAssets?: number; profileGridTile?: boolean },
): Loose | null {
  if (!post) return null;
  const media = asLoose(post.media);
  const maxAssets = typeof opts?.maxAssets === "number" && opts.maxAssets >= 1 ? Math.min(opts.maxAssets, 12) : 12;
  const declared =
    typeof media?.assetCount === "number" && Number.isFinite(media.assetCount as number)
      ? Math.floor(media.assetCount as number)
      : null;
  const rawAssets = Array.isArray(media?.assets) ? (media.assets as unknown[]) : [];
  const trimmed = rawAssets.slice(0, maxAssets).map(slimCanonicalMediaAsset).filter(Boolean) as Loose[];
  const gridTile = opts?.profileGridTile === true;
  const next: Loose = {
    id: post.id,
    postContractVersion: post.postContractVersion,
    media: {
      ...(declared != null ? { assetCount: declared } : {}),
      assets: trimmed,
    },
  };
  if (!gridTile) {
    next.viewerState = post.viewerState;
    next.engagement = post.engagement;
    next.engagementPreview = post.engagementPreview;
    next.classification = post.classification;
    next.author = post.author;
    next.text = post.text;
    next.location = post.location;
  } else {
    const cl = asLoose(post.classification);
    if (cl && typeof cl.mediaKind === "string" && cl.mediaKind.trim()) {
      next.classification = { mediaKind: cl.mediaKind };
    }
  }
  return next;
}

export function slimFeedWireCard(card: Loose): Loose {
  const ap = slimAppPostRecordForCompactWire(
    (((card.appPost ?? card.appPostV2) as Loose | undefined) ?? null) as Loose | null
  );
  const geoIn = card.geo as Loose | undefined;
  const trimmedGeo =
    geoIn && typeof geoIn === "object"
      ? ({
          ...geoIn,
          geohash: null
        } as typeof card.geo)
      : card.geo;
  const trimmedAssets =
    Array.isArray(card.assets) ?
      (card.assets as Loose[]).map((asset) => {
        const copy = { ...asset };
        delete copy.variants;
        return copy;
      })
    : card.assets;

  const next = {
    ...card,
    geo: trimmedGeo,
    assets: trimmedAssets,
    ...(ap ? { appPostV2: ap as Record<string, unknown>, postContractVersion: 3 as const } : {})
  } as Loose;
  // Drop duplicate compat mirrors on slim wire.
  delete next.appPost;
  delete next.canonicalPost;
  delete next.post;
  return next;
}

/**
 * Compact tile DTO for profile / user-display grid pagination (liftable fetches detail on tap).
 */
export function finalizeProfileGridWireItem(item: Loose): Loose {
  const postId =
    (typeof item.postId === "string" && item.postId.trim()) ||
    (typeof item.id === "string" && item.id.trim()) ||
    "";
  const apIn = ((item.appPostV2 ?? item.appPost) as Loose | undefined) ?? null;
  const ap = slimAppPostRecordForCompactWire(apIn ?? null, { maxAssets: 1, profileGridTile: true });
  const thumbUrl =
    (typeof item.thumbUrl === "string" && item.thumbUrl.trim()) ||
    (typeof item.displayPhotoLink === "string" && item.displayPhotoLink.trim()) ||
    "";
  const apClassification = ap ? asLoose(ap.classification) : null;
  const mediaType =
    (typeof item.mediaType === "string" && item.mediaType.trim()) ||
    (typeof apClassification?.mediaKind === "string" ? apClassification.mediaKind.trim() : "") ||
    null;
  const aspectRatio = typeof item.aspectRatio === "number" && Number.isFinite(item.aspectRatio) ? item.aspectRatio : null;
  const out: Loose = {
    postId,
    id: postId,
    postContractVersion: 3,
  };
  if (thumbUrl) {
    out.thumbUrl = thumbUrl;
    out.displayPhotoLink = thumbUrl;
  }
  if (mediaType) out.mediaType = mediaType;
  if (aspectRatio != null) out.aspectRatio = aspectRatio;
  if (typeof item.processing === "boolean") out.processing = item.processing;
  if (typeof item.processingFailed === "boolean") out.processingFailed = item.processingFailed;
  const eng = asLoose(item.engagement);
  if (eng && typeof eng.likeCount === "number") {
    out.engagement = {
      likeCount: eng.likeCount,
      commentCount: typeof eng.commentCount === "number" ? eng.commentCount : 0,
      saveCount: typeof eng.saveCount === "number" ? eng.saveCount : 0,
    };
  }
  if (ap) out.appPostV2 = ap;
  return out;
}
