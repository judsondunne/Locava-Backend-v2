import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { mutationStateRepository } from "../../repositories/mutations/mutation-state.repository.js";
import type { SearchRepository } from "../../repositories/surfaces/search.repository.js";
import { SearchDiscoveryService } from "./search-discovery.service.js";

function canonicalizeQuery(raw: string): string {
  const q = raw.trim().toLowerCase();
  if (!q) return q;
  const stripped = q
    .replace(/\b(fun|best|top|cool|awesome)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || q;
}

function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export class SearchService {
  private readonly discoveryService = new SearchDiscoveryService();

  constructor(private readonly repository: SearchRepository) {}

  private toPostCardSummary(
    row: {
      postId?: string;
      id?: string;
      userId?: string;
      userHandle?: string;
      userName?: string;
      userPic?: string | null;
      activities?: string[];
      title?: string;
      thumbUrl?: string;
      displayPhotoLink?: string;
      mediaType?: "image" | "video";
      likeCount?: number;
      commentCount?: number;
      createdAtMs?: number;
      updatedAtMs?: number;
      carouselFitWidth?: boolean;
      layoutLetterbox?: boolean;
      letterboxGradientTop?: string | null;
      letterboxGradientBottom?: string | null;
      letterboxGradients?: Array<{ top: string; bottom: string }> | null;
    },
    index: number,
    normalized: string,
    viewerId: string,
  ) {
    const postId = String(row.postId ?? row.id ?? "");
    const authorHandle = String(row.userHandle ?? "").replace(/^@+/, "").trim();
    const authorName = String(row.userName ?? "").trim();
    const authorPicCandidate = row.userPic;
    const posterUrl = String(row.thumbUrl || row.displayPhotoLink || "");
    const mediaType: "image" | "video" = row.mediaType === "video" ? "video" : "image";
    const startupHint: "poster_only" | "poster_then_preview" =
      mediaType === "video" ? "poster_then_preview" : "poster_only";
    return {
      postId,
      rankToken: `search-rank-${normalized.slice(0, 16)}-${index + 1}`,
      author: {
        userId: String(row.userId ?? ""),
        handle: authorHandle,
        name: authorName || null,
        pic: isUrl(String(authorPicCandidate ?? "")) ? String(authorPicCandidate) : null
      },
      activities: row.activities ?? [],
      title: row.title || null,
      captionPreview: row.title || null,
      firstAssetUrl: posterUrl,
      carouselFitWidth: typeof row.carouselFitWidth === "boolean" ? row.carouselFitWidth : undefined,
      layoutLetterbox: typeof row.layoutLetterbox === "boolean" ? row.layoutLetterbox : undefined,
      letterboxGradientTop: typeof row.letterboxGradientTop === "string" || row.letterboxGradientTop === null ? row.letterboxGradientTop : undefined,
      letterboxGradientBottom: typeof row.letterboxGradientBottom === "string" || row.letterboxGradientBottom === null ? row.letterboxGradientBottom : undefined,
      letterboxGradients: Array.isArray(row.letterboxGradients) && row.letterboxGradients.length > 0 ? row.letterboxGradients : undefined,
      media: {
        type: mediaType,
        posterUrl,
        aspectRatio: 1,
        startupHint
      },
      social: {
        likeCount: Math.max(0, Number(row.likeCount ?? 0)),
        commentCount: Math.max(0, Number(row.commentCount ?? 0))
      },
      viewer: {
        liked: mutationStateRepository.hasViewerLikedPost(viewerId, postId),
        saved: mutationStateRepository.resolveViewerSavedPost(viewerId, postId, false)
      },
      createdAtMs: Math.max(0, Number(row.createdAtMs ?? row.updatedAtMs ?? Date.now())),
      updatedAtMs: Math.max(0, Number(row.updatedAtMs ?? Date.now()))
    };
  }

  async loadResultsBundle(input: {
    viewerId: string;
    query: string;
    cursor: string | null;
    limit: number;
    lat: number | null;
    lng: number | null;
    wantedTypes: Set<string>;
    includeDebug?: boolean;
  }) {
    const { viewerId, query, cursor, limit, lat, lng, wantedTypes, includeDebug = false } = input;
    const normalized = query.trim().toLowerCase();
    const cursorPart = cursor ?? "start";
    const geoKey =
      typeof lat === "number" && typeof lng === "number"
        ? `${lat.toFixed(3)},${lng.toFixed(3)}`
        : "nogeo";
    return dedupeInFlight(`search-results-bundle:${viewerId}:${normalized}:${cursorPart}:${limit}:${geoKey}:${[...wantedTypes].sort().join(",")}`, () =>
      withConcurrencyLimit("search-results-bundle-repo", 4, async () => {
        const fallbacks: string[] = [];
        const parsedIntent = this.discoveryService.parseIntent(normalized);
        if (parsedIntent.nearMe && !(typeof lat === "number" && typeof lng === "number")) {
          fallbacks.push("near_me_viewer_location_unavailable");
        }
        const canUseFastPosts =
          this.discoveryService.isEnabled() &&
          process.env.FIRESTORE_TEST_MODE !== "emulator" &&
          wantedTypes.has("posts") &&
          cursor == null &&
          (parsedIntent.activity != null || parsedIntent.location != null || parsedIntent.nearMe);
        const fastPosts = canUseFastPosts
          ? await this.discoveryService
              .searchPostsForQuery(normalized, {
                limit,
                lat,
                lng
              })
              .catch(() => [])
          : [];
        // Fast path must never replace the repository with an empty page when structured intent exists.
        const useFastPosts = canUseFastPosts && fastPosts.length > 0;
        const postsPage =
          wantedTypes.has("posts") && !useFastPosts
            ? await this.repository.getSearchResultsPage({
                viewerId,
                query: canonicalizeQuery(normalized),
                cursor,
                limit,
                lat,
                lng,
                includeDebug,
              })
            : {
                query: normalized,
                cursorIn: cursor,
                items: [],
                hasMore: false,
                nextCursor: null
              };
        // Final safety net: if repo returns empty due to fallback/unavailability, try the fast discovery path
        // for the first page so the UI doesn't show a blank posts rail.
        let postsSource = useFastPosts ? fastPosts : postsPage.items;
        if (
          wantedTypes.has("posts") &&
          postsSource.length === 0 &&
          cursor == null &&
          (parsedIntent.activity != null || parsedIntent.location != null || parsedIntent.nearMe)
        ) {
          if (!this.discoveryService.isEnabled()) {
            fallbacks.push("search_results_discovery_unavailable");
          } else
          try {
            const recovered = await this.discoveryService.searchPostsForQuery(normalized, { limit, lat, lng });
            if (recovered.length > 0) {
              fallbacks.push("search_results_fast_posts_recovery");
              postsSource = recovered;
            }
          } catch {
            // ignore
          }
        }
        const posts = postsSource
          .slice(0, Math.max(limit * 2, limit + 2))
          .map((row, index) => this.toPostCardSummary(row, index, normalized, viewerId))
          .filter((row) => isUrl(String(row.media?.posterUrl ?? "")))
          .slice(0, limit);

        const mixActivities = parsedIntent.activity?.queryActivities.length
          ? parsedIntent.activity.queryActivities
          : await this.discoveryService.loadTopActivities(6);
        const mixLocationText = parsedIntent.nearMe
          ? "near me"
          : parsedIntent.location?.displayText ?? null;
        const [suggestedUsers, collectionsSection] = await Promise.all([
          wantedTypes.has("users")
            ? this.discoveryService.searchUsersForQuery(normalized, Math.min(8, limit))
            : Promise.resolve([]),
          wantedTypes.has("collections")
            ? this.discoveryService.searchCollections({
                viewerId,
                query: normalized,
                limit
              })
            : Promise.resolve([]),
        ]);

        const filteredCollections = Array.isArray(collectionsSection) ? collectionsSection.slice(0, limit) : [];
        const filteredMixes = wantedTypes.has("mixes")
          ? this.discoveryService
              .buildMixSpecsFromActivities(mixActivities.slice(0, Math.min(limit, 4)), mixLocationText)
              .map((mix) => ({
                id: mix.id,
                title: mix.title,
                subtitle: mix.subtitle,
                heroQuery: mix.heroQuery ?? ""
              }))
              .slice(0, limit)
          : [];

        const filteredUsers = Array.isArray(suggestedUsers)
          ? suggestedUsers.slice(0, Math.min(8, limit))
          : [];

        return {
          page: {
            cursorIn: cursor,
            limit,
            count: posts.length,
            hasMore: useFastPosts ? false : postsPage.hasMore,
            nextCursor: useFastPosts ? null : postsPage.nextCursor,
            sort: "search_ranked_v1" as const
          },
          items: wantedTypes.has("posts") ? posts : [],
          ...(includeDebug
            ? {
                debugSearch: {
                  rawQuery: query,
                  parsedActivityKeys: parsedIntent.activity?.queryActivities ?? [],
                  parsedLocation: parsedIntent.nearMe
                    ? { kind: "near_me" }
                    : parsedIntent.location
                      ? {
                          kind: parsedIntent.location.cityRegionId ? "city" : "state",
                          displayText: parsedIntent.location.displayText,
                          cityRegionId: parsedIntent.location.cityRegionId,
                          stateRegionId: parsedIntent.location.stateRegionId,
                        }
                      : null,
                  nearMeCoordinatesUsed:
                    parsedIntent.nearMe && typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
                  returnedCount: posts.length,
                  cursorIn: cursor,
                  nextCursor: useFastPosts ? null : postsPage.nextCursor,
                  hasMore: useFastPosts ? false : postsPage.hasMore,
                  fallbacks,
                  repoDebug: (postsPage as any)?.debug ?? undefined,
                },
              }
            : {}),
          sections: {
            posts: {
              items: wantedTypes.has("posts") ? posts : [],
              hasMore: useFastPosts ? false : postsPage.hasMore,
              cursor: useFastPosts ? null : postsPage.nextCursor
            },
            collections: {
              items: filteredCollections,
              hasMore: false,
              cursor: null
            },
            users: {
              items: filteredUsers.map((user) => ({
                userId: String(user.userId ?? user.id ?? ""),
                handle: String(user.handle ?? ""),
                displayName: String(user.name ?? "") || null,
                profilePic: String(user.profilePic ?? "") || null
              })),
              hasMore: false,
              cursor: null
            },
            mixes: {
              items: filteredMixes,
              hasMore: false,
              cursor: null
            }
          },
          degraded: fallbacks.length > 0,
          fallbacks
        };
      })
    );
  }

  async loadResultsPage(input: {
    viewerId: string;
    query: string;
    cursor: string | null;
    limit: number;
    lat: number | null;
    lng: number | null;
  }) {
    const bundle = await this.loadResultsBundle({
      ...input,
      wantedTypes: new Set(["posts"])
    });
    return {
      query: input.query.trim().toLowerCase(),
      cursorIn: input.cursor,
      items: bundle.items,
      hasMore: bundle.page.hasMore,
      nextCursor: bundle.page.nextCursor
    };
  }
}
