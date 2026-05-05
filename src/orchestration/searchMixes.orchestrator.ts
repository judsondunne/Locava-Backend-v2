import { mixCache } from "../cache/mixCache.js";
import { batchHydrateAppPostsOnRecords } from "../lib/posts/app-post-v2/enrichAppPostV2Response.js";
import { SearchMixesServiceV2 } from "../services/mixes/v2/searchMixes.service.js";
import { firestoreAssetsToCompactSeeds, toSearchMixPreviewDTO } from "../dto/compact-surface-dto.js";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanStringArray(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

function toCompactSeedAsset(row: Record<string, unknown>) {
  const firstAsset =
    Array.isArray(row.assets) && row.assets[0] && typeof row.assets[0] === "object"
      ? (row.assets[0] as Record<string, unknown>)
      : null;
  const mediaType: "image" | "video" =
    String(row.mediaType ?? "").toLowerCase() === "video" ? "video" : "image";
  const posterUrl =
    cleanString(row.thumbUrl) ??
    cleanString(row.displayPhotoLink) ??
    cleanString(firstAsset?.posterUrl) ??
    cleanString(firstAsset?.poster) ??
    cleanString(firstAsset?.thumbnail) ??
    "";
  const previewUrl =
    cleanString(firstAsset?.previewUrl) ??
    cleanString(firstAsset?.thumbnail) ??
    cleanString(firstAsset?.posterUrl) ??
    cleanString(firstAsset?.poster) ??
    cleanString(row.displayPhotoLink) ??
    cleanString(row.thumbUrl);
  const originalUrl =
    cleanString(firstAsset?.originalUrl) ??
    cleanString(firstAsset?.original) ??
    cleanString(row.displayPhotoLink) ??
    previewUrl;
  const streamUrl =
    cleanString(firstAsset?.streamUrl) ??
    cleanString((firstAsset?.variants as Record<string, unknown> | undefined)?.hls);
  const mp4Url =
    cleanString(firstAsset?.mp4Url) ??
    cleanString((firstAsset?.variants as Record<string, unknown> | undefined)?.main720Avc) ??
    cleanString((firstAsset?.variants as Record<string, unknown> | undefined)?.main720) ??
    cleanString(firstAsset?.original);
  return {
    type: mediaType,
    posterUrl,
    previewUrl,
    originalUrl,
    streamUrl,
    mp4Url,
    asset: firstAsset,
  };
}

export class SearchMixesOrchestrator {
  private readonly v2 = new SearchMixesServiceV2();

  async bootstrap(input: {
    viewerId: string;
    lat: number | null;
    lng: number | null;
    limit: number;
    includeDebug: boolean;
  }): Promise<{
    routeName: "search.mixes.bootstrap.get";
    mixes: Array<Record<string, unknown>>;
    scoringVersion: string;
    debug?: Record<string, unknown>;
  }> {
    const scoringVersion = "mixes_v2";
    const cacheKey = `v2_search_mixes_bootstrap:${input.viewerId}:${input.lat ?? "_"}:${input.lng ?? "_"}:${input.limit}:${input.includeDebug ? "d" : "_"}`;
    const cached = mixCache.get<{ mixes: Array<Record<string, unknown>>; scoringVersion: string }>(cacheKey);
    if (cached) {
      return { routeName: "search.mixes.bootstrap.get", mixes: cached.mixes, scoringVersion: cached.scoringVersion };
    }

    const viewerCoords = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const payload = await this.v2.bootstrap({
      viewerId: input.viewerId,
      viewerCoords,
      limitGeneral: input.limit,
      includeDebug: input.includeDebug,
    });

    // Contract expects SearchMixSchema (id/key/title/subtitle/type/intent/coverImageUrl/...)
    const mixes = payload.mixes.map((m) => ({
      id: m.mixId,
      key: m.mixId,
      title: m.title,
      subtitle: m.subtitle,
      type: m.mixType === "general" ? "general" : m.mixType,
      intent: {
        seedKind:
          m.definition.kind === "friends" ? "friends" : m.definition.kind === "daily" ? "daily" : "activity_query",
        seedQuery: m.definition.kind === "activity" ? `${m.definition.activity}` : null,
        activityFilters: m.definition.kind === "activity" && m.definition.activity ? [m.definition.activity] : [],
        locationLabel: m.mixType === "nearby" ? "Near you" : null,
        locationConstraint: null,
      },
      coverImageUrl: m.coverMedia,
      coverPostId: m.coverPostId,
      previewPostIds: m.previewPostIds,
      candidateCount: m.availableCount,
      requiresLocation: Boolean(m.requiresLocation),
      requiresFollowing: Boolean(m.requiresFollowing),
      hiddenReason: m.hiddenReason ?? null,
      ...(input.includeDebug ? { debugMix: m.debugMix ?? {} } : {}),
    }));

    mixCache.set(cacheKey, { mixes, scoringVersion }, 15_000);
    return {
      routeName: "search.mixes.bootstrap.get",
      mixes,
      scoringVersion,
      ...(input.includeDebug ? { debug: payload.debug ?? {} } : {}),
    };
  }

  async feedPage(input: {
    viewerId: string;
    mixId: string;
    lat: number | null;
    lng: number | null;
    limit: number;
    cursor: string | null;
    includeDebug: boolean;
  }): Promise<{
    routeName: "search.mixes.feed.post";
    mixId: string;
    mixType?: string;
    posts: Array<Record<string, unknown>>;
    nextCursor: string | null;
    hasMore: boolean;
    scoringVersion: string;
    debug?: Record<string, unknown>;
  }> {
    const scoringVersion = "mixes_v2";
    const viewerCoords = input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;
    const payload = await this.v2.feed({
      viewerId: input.viewerId,
      mixId: input.mixId,
      viewerCoords,
      limit: input.limit,
      cursor: input.cursor ?? null,
      includeDebug: input.includeDebug,
    });
    const rowRecords = payload.posts.map((row, index) => {
      const postId = String(row.postId ?? row.id ?? "");
      const rawAssets = Array.isArray((row as Record<string, unknown>).assets)
        ? ((row as Record<string, unknown>).assets as unknown[])
        : [];
      const compactFromFirestore =
        rawAssets.length > 0 ? firestoreAssetsToCompactSeeds(rawAssets, postId, 12) : [];
      const compactAsset = toCompactSeedAsset(row as Record<string, unknown>);
      const primary = compactFromFirestore[0];
      const mediaType: "image" | "video" = primary?.type === "video" ? "video" : compactAsset.type;
      const posterUrl = cleanString(primary?.posterUrl) ?? compactAsset.posterUrl ?? "";
      return toSearchMixPreviewDTO({
        postId,
        rankToken: `mix-${input.mixId}-${index + 1}`,
        author: {
          userId: String(row.userId ?? ""),
          handle: String(row.userHandle ?? "").replace(/^@+/, "") || "unknown",
          name: typeof row.userName === "string" ? row.userName : null,
          pic: typeof row.userPic === "string" ? row.userPic : null,
        },
        title: typeof row.title === "string" ? row.title : typeof row.caption === "string" ? row.caption : null,
        captionPreview: typeof row.caption === "string" ? row.caption : typeof row.title === "string" ? row.title : null,
        activities: cleanStringArray(row.activities),
        locationSummary: typeof row.address === "string" ? row.address : null,
        address: typeof row.address === "string" ? row.address : null,
        media: {
          type: mediaType,
          posterUrl,
          aspectRatio:
            cleanNumber(primary?.aspectRatio) ??
            cleanNumber(compactAsset.asset?.aspectRatio) ??
            1,
          startupHint: mediaType === "video" ? "poster_then_preview" : "poster_only",
        },
        geo: {
          lat: typeof row.lat === "number" ? row.lat : null,
          long: typeof row.lng === "number" ? row.lng : typeof row.long === "number" ? row.long : null,
        },
        assets:
          compactFromFirestore.length > 0
            ? compactFromFirestore
            : compactAsset.asset
              ? [
                  {
                    id: cleanString(compactAsset.asset.id) ?? `${postId}-asset-1`,
                    type: compactAsset.type,
                    previewUrl: compactAsset.previewUrl,
                    posterUrl: compactAsset.posterUrl || null,
                    originalUrl: compactAsset.originalUrl,
                    streamUrl: compactAsset.streamUrl,
                    mp4Url: compactAsset.mp4Url,
                    blurhash: cleanString(compactAsset.asset.blurhash),
                    width: cleanNumber(compactAsset.asset.width),
                    height: cleanNumber(compactAsset.asset.height),
                    aspectRatio: cleanNumber(compactAsset.asset.aspectRatio),
                    orientation: cleanString(compactAsset.asset.orientation),
                  },
                ]
              : [],
        ...(compactFromFirestore.length > 0 ? { compactAssetLimit: 12 } : {}),
        createdAtMs: typeof row.time === "number" ? row.time : Date.now(),
        updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : typeof row.time === "number" ? row.time : Date.now(),
        social: {
          likeCount: typeof row.likeCount === "number" ? row.likeCount : 0,
          commentCount: typeof row.commentCount === "number" ? row.commentCount : 0,
        },
        viewer: { liked: false, saved: false },
        firstAssetUrl:
          cleanString(primary?.originalUrl) ??
          cleanString(primary?.previewUrl) ??
          (compactAsset.originalUrl ?? compactAsset.previewUrl ?? compactAsset.posterUrl ?? null),
        sourceRawPost: row as Record<string, unknown>,
      });
    });
    await batchHydrateAppPostsOnRecords(rowRecords as Array<Record<string, unknown>>, input.viewerId);
    return {
      routeName: "search.mixes.feed.post",
      mixId: input.mixId,
      mixType: payload.mixType,
      posts: rowRecords,
      nextCursor: payload.nextCursor,
      hasMore: payload.hasMore,
      scoringVersion,
      ...(input.includeDebug ? { debug: payload.debug ?? {} } : {}),
    };
  }
}
