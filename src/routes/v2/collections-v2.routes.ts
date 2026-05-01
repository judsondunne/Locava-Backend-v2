import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { deleteEntityCacheKeys, entityCacheKeys } from "../../cache/entity-cache.js";
import { invalidateRouteCacheByTags } from "../../cache/route-cache-index.js";
import {
  CollectionsListQuerySchema,
  collectionsListContract
} from "../../contracts/surfaces/collections-list.contract.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { scheduleBackgroundWork } from "../../lib/background-work.js";
import { failure, success } from "../../lib/response.js";
import { incrementDbOps, recordInvalidation, setRouteName } from "../../observability/request-context.js";
import { CollectionsFirestoreAdapter } from "../../repositories/source-of-truth/collections-firestore.adapter.js";
import { FeedFirestoreAdapter, type FirestoreFeedCandidate } from "../../repositories/source-of-truth/feed-firestore.adapter.js";
import { FeedRepository } from "../../repositories/surfaces/feed.repository.js";
import { FeedService } from "../../services/surfaces/feed.service.js";
import { SearchRepository } from "../../repositories/surfaces/search.repository.js";
import { mutationStateRepository } from "../../repositories/mutations/mutation-state.repository.js";
import { collectionTelemetryRepository } from "../../repositories/surfaces/collection-telemetry.repository.js";
import { wasabiPublicUrlForKey } from "../../services/storage/wasabi-config.js";
import { getWasabiConfigOrNull, uploadPostSessionStagingFromBuffer } from "../../services/storage/wasabi-staging.service.js";
import { buildPostEnvelope } from "../../lib/posts/post-envelope.js";

const CreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  privacy: z.enum(["public", "private"]).default("private"),
  collaborators: z.array(z.string().trim().min(1)).max(50).optional(),
  items: z.array(z.string().trim().min(1)).max(200).optional(),
  coverUri: z.string().url().optional(),
  color: z.string().optional(),
});
const PatchBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  privacy: z.enum(["private", "friends", "public"]).optional(),
  coverUri: z.string().url().optional(),
  color: z.string().optional(),
});
const AddPostBodySchema = z.object({ postId: z.string().trim().min(1) });
const CollectionParamsSchema = z.object({ collectionId: z.string().trim().min(1) });
const CoverBodySchema = z.object({
  coverUri: z.string().trim().url().optional(),
  url: z.string().trim().url().optional(),
  imageUrl: z.string().trim().url().optional()
});
const CollectionPostsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(12),
});
const PostParamsSchema = z.object({ postId: z.string().trim().min(1) });
const SaveSheetQuerySchema = z.object({ postId: z.string().trim().min(1) });

const collectionsAdapter = new CollectionsFirestoreAdapter();
const feedService = new FeedService(new FeedRepository());
const feedFirestoreAdapter = new FeedFirestoreAdapter();
const searchRepository = new SearchRepository();

function isDynamicCollectionId(collectionId: string): boolean {
  return String(collectionId ?? "").startsWith("dyn:");
}

function dynamicQueryFromCollectionId(collectionId: string): string {
  const raw = String(collectionId ?? "").trim();
  const slug = raw.replace(/^dyn:/i, "");
  const q = slug.replace(/[-_]+/g, " ").trim();
  return q || "search";
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function toDynamicPostCardSummary(
  row: {
    postId: string;
    rank: number;
    userId: string;
    userHandle: string;
    userName: string;
    userPic: string | null;
    activities: string[];
    title: string;
    thumbUrl: string;
    displayPhotoLink: string;
    mediaType: "image" | "video";
    likeCount: number;
    commentCount: number;
    updatedAtMs: number;
  },
  index: number,
  viewerId: string,
  rankSeed: string,
) {
  const posterUrl = String(row.thumbUrl || row.displayPhotoLink || "").trim();
  const mediaType: "image" | "video" = row.mediaType === "video" ? "video" : "image";
  const startupHint: "poster_only" | "poster_then_preview" =
    mediaType === "video" ? "poster_then_preview" : "poster_only";
  const seed = {
    postId: row.postId,
    rankToken: `dyn-${rankSeed.slice(0, 16)}-${index + 1}`,
    author: {
      userId: String(row.userId ?? ""),
      handle: String(row.userHandle ?? "").replace(/^@+/, ""),
      name: String(row.userName ?? "").trim() || null,
      pic: typeof row.userPic === "string" && /^https?:\/\//i.test(row.userPic) ? row.userPic : null
    },
    activities: Array.isArray(row.activities) ? row.activities : [],
    title: String(row.title ?? "").trim() || null,
    captionPreview: String(row.title ?? "").trim() || null,
    firstAssetUrl: /^https?:\/\//i.test(posterUrl) ? posterUrl : null,
    media: {
      type: mediaType,
      posterUrl,
      aspectRatio: 1,
      startupHint
    },
    social: {
      likeCount: Math.max(0, Number(row.likeCount ?? 0)),
      commentCount: Math.max(0, Number(row.commentCount ?? 0)),
    },
    viewer: {
      liked: mutationStateRepository.hasViewerLikedPost(viewerId, row.postId),
      saved: mutationStateRepository.resolveViewerSavedPost(viewerId, row.postId, false),
    },
    createdAtMs: Math.max(0, Number(row.updatedAtMs ?? Date.now())),
    updatedAtMs: Math.max(0, Number(row.updatedAtMs ?? Date.now())),
  };
  return buildPostEnvelope({
    postId: row.postId,
    seed,
    sourcePost: row as unknown as Record<string, unknown>,
    rawPost: row as unknown as Record<string, unknown>,
    hydrationLevel: "card",
    sourceRoute: "collections.dynamic",
    rankToken: seed.rankToken,
    author: seed.author,
    social: seed.social,
    viewer: seed.viewer,
    debugSource: "toDynamicPostCardSummary",
  });
}

function queueEntityInvalidation(invalidationType: string, keys: string[]): { invalidatedKeysCount: number; invalidationTypes: string[] } {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  recordInvalidation(invalidationType, { entityKeyCount: uniqueKeys.length });
  scheduleBackgroundWork(async () => {
    await deleteEntityCacheKeys(uniqueKeys);
  });
  return {
    invalidatedKeysCount: uniqueKeys.length,
    invalidationTypes: uniqueKeys.length > 0 ? [invalidationType] : ["no_op_idempotent"]
  };
}

async function invalidateSavedRouteCache(viewerId: string): Promise<string[]> {
  const tags = [`route:collections.saved:${viewerId}`];
  return invalidateRouteCacheByTags(tags, { deferIndexCleanup: true });
}

function encodeCollectionsCursor(offset: number): string {
  return `offset:${offset}`;
}

function decodeCollectionsCursor(cursor?: string): number {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/.exec(cursor.trim());
  if (!match) {
    throw new Error("invalid_cursor");
  }
  return Number.parseInt(match[1] ?? "0", 10);
}

async function hydratePostCards(viewerId: string, postIds: string[]) {
  const ordered = postIds.map((id) => id.trim()).filter(Boolean);
  const unique = [...new Set(ordered)];
  let directById = new Map<string, ReturnType<typeof projectCollectionCard>>();
  if (feedFirestoreAdapter.isEnabled() && unique.length > 0) {
    try {
      const direct = await feedFirestoreAdapter.getCandidatesByPostIds(unique);
      incrementDbOps("queries", direct.queryCount);
      incrementDbOps("reads", direct.readCount);
      directById = new Map(direct.items.map((row) => [row.postId, projectCollectionCard(row, viewerId)] as const));
    } catch {
      directById = new Map();
    }
  }
  const missing = unique.filter((postId) => !directById.has(postId));
  const fallbackCards = missing.length > 0 ? await feedService.loadPostCardSummaryBatch(viewerId, missing) : [];
  const fallbackById = new Map(fallbackCards.map((row) => [row.postId, projectCollectionFallbackCard(row)] as const));
  return ordered
    .map((postId) => directById.get(postId) ?? fallbackById.get(postId))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      ...row,
      rankToken: `collection-rank-${row.postId}`,
      viewer: {
        ...((row.viewer && typeof row.viewer === "object") ? row.viewer : {}),
        saved: true
      }
    }));
}

function projectCollectionCard(row: FirestoreFeedCandidate, viewerId: string) {
  const seed = {
    postId: row.postId,
    rankToken: `collection-rank-${row.postId}`,
    author: {
      userId: row.authorId,
      handle: row.authorHandle ?? (row.authorId ? row.authorId.replace(/^@+/, "") : "unknown"),
      name: row.authorName,
      pic: row.authorPic
    },
    activities: row.activities,
    address: row.address,
    geo: row.geo,
    title: row.title,
    captionPreview: row.captionPreview,
    firstAssetUrl: row.firstAssetUrl,
    media: {
      type: row.mediaType,
      posterUrl: row.posterUrl,
      aspectRatio: row.assets[0]?.aspectRatio ?? 9 / 16,
      startupHint: row.mediaType === "video" ? ("poster_then_preview" as const) : ("poster_only" as const)
    },
    social: {
      likeCount: row.likeCount,
      commentCount: row.commentCount
    },
    viewer: {
      liked: row.likedByUserIds.includes(viewerId),
      saved: true
    },
    updatedAtMs: row.updatedAtMs
  };
  return buildPostEnvelope({
    postId: row.postId,
    seed,
    sourcePost: row.sourcePost ?? row.rawPost ?? (row as unknown as Record<string, unknown>),
    rawPost: row.rawPost ?? row.sourcePost ?? (row as unknown as Record<string, unknown>),
    hydrationLevel: "card",
    sourceRoute: "collections.feed_projection",
    rankToken: seed.rankToken,
    author: seed.author,
    social: seed.social,
    viewer: seed.viewer,
    debugSource: "projectCollectionCard",
  });
}

function projectCollectionFallbackCard(
  row: Awaited<ReturnType<FeedService["loadPostCardSummaryBatch"]>>[number]
) {
  return buildPostEnvelope({
    postId: row.postId,
    seed: {
      ...row,
      rankToken: `collection-rank-${row.postId}`,
    } as unknown as Record<string, unknown>,
    sourcePost:
      ((row as unknown as { sourcePost?: Record<string, unknown> | null }).sourcePost) ??
      ((row as unknown as { rawPost?: Record<string, unknown> | null }).rawPost) ??
      (row as unknown as Record<string, unknown>),
    rawPost:
      ((row as unknown as { rawPost?: Record<string, unknown> | null }).rawPost) ??
      ((row as unknown as { sourcePost?: Record<string, unknown> | null }).sourcePost) ??
      (row as unknown as Record<string, unknown>),
    hydrationLevel: "card",
    sourceRoute: "collections.fallback_projection",
    rankToken: `collection-rank-${row.postId}`,
    author: row.author as unknown as Record<string, unknown>,
    social: row.social as unknown as Record<string, unknown>,
    viewer: row.viewer as unknown as Record<string, unknown>,
    debugSource: "projectCollectionFallbackCard",
  });
}

function toCollectionListItem(
  collection: Awaited<ReturnType<typeof collectionsAdapter.listViewerCollections>>[number]
) {
  return {
    ...collection,
    items: []
  };
}

export async function registerV2CollectionsRoutes(app: FastifyInstance): Promise<void> {
  app.get(collectionsListContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const query = CollectionsListQuerySchema.parse(request.query);
    setRouteName(collectionsListContract.routeName);
    let cursorOffset = 0;
    try {
      cursorOffset = decodeCollectionsCursor(query.cursor);
    } catch {
      return reply.status(400).send(failure("invalid_cursor", "Cursor is invalid"));
    }
    const requestedWindow = Math.max(query.limit, cursorOffset + query.limit);
    const allItems = await collectionsAdapter.listViewerCollections({
      viewerId: viewer.viewerId,
      limit: Math.min(120, requestedWindow)
    });
    const items = allItems.slice(cursorOffset, cursorOffset + query.limit);
    const nextOffset = cursorOffset + items.length;
    const hasMore = nextOffset < allItems.length;
    const nextCursor = hasMore ? encodeCollectionsCursor(nextOffset) : null;
    return success({
      routeName: collectionsListContract.routeName,
      page: {
        limit: query.limit,
        count: items.length,
        hasMore,
        nextCursor
      },
      items: items.map(toCollectionListItem)
    });
  });

  app.get("/v2/collections/:collectionId", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionParamsSchema.parse(request.params);
    setRouteName("collections.detail.get");
    if (isDynamicCollectionId(params.collectionId)) {
      const q = dynamicQueryFromCollectionId(params.collectionId);
      const title = titleCaseWords(q);
      let coverUri: string | undefined = undefined;
      try {
        const page = await searchRepository.getSearchResultsPage({
          viewerId: viewer.viewerId,
          query: q,
          cursor: null,
          limit: 1,
          lat: null,
          lng: null,
          includeDebug: false,
        });
        const first = page.items[0];
        const u = first ? String(first.thumbUrl ?? first.displayPhotoLink ?? "").trim() : "";
        if (/^https?:\/\//i.test(u)) coverUri = u;
      } catch {
        // ignore
      }
      const now = new Date().toISOString();
      return success({
        routeName: "collections.detail.get" as const,
        item: {
          id: params.collectionId,
          ownerId: "system",
          name: title,
          description: `Dynamic collection for "${title}"`,
          privacy: "public",
          ...(coverUri ? { coverUri } : {}),
          collaborators: [],
          items: [],
          itemsCount: 0,
          createdAt: now,
          updatedAt: now,
          kind: "backend" as const,
        },
      });
    }
    const item = await collectionsAdapter.getCollection({
      viewerId: viewer.viewerId,
      collectionId: params.collectionId,
    });
    if (!item) return reply.status(404).send(failure("collection_not_found", "Collection not found"));
    return success({ routeName: "collections.detail.get" as const, item });
  });

  app.get("/v2/collections/:collectionId/posts", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionParamsSchema.parse(request.params);
    const query = CollectionPostsQuerySchema.parse(request.query);
    setRouteName("collections.posts.get");
    try {
      if (isDynamicCollectionId(params.collectionId)) {
        const q = dynamicQueryFromCollectionId(params.collectionId);
        const page = await searchRepository.getSearchResultsPage({
          viewerId: viewer.viewerId,
          query: q,
          cursor: query.cursor ?? null,
          limit: query.limit,
          lat: null,
          lng: null,
          includeDebug: false,
        });
        const rankSeed = `${params.collectionId}:${query.cursor ?? "start"}`;
        const items = page.items
          .map((row, index) => toDynamicPostCardSummary(row, index, viewer.viewerId, rankSeed))
          .filter((row) => /^https?:\/\//i.test(String(row.media?.posterUrl ?? "")));
        const postIds = items.map((row) => row.postId);
        return success({
          routeName: "collections.posts.get" as const,
          requestKey: `${params.collectionId}:${query.cursor ?? "start"}:${query.limit}`,
          page: {
            cursorIn: query.cursor ?? null,
            limit: query.limit,
            count: items.length,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            sort: "saved_at_desc" as const,
          },
          items,
          postIds,
          degraded: true,
          fallbacks: ["dynamic_collection_search_rank"],
        });
      }
      const page = await collectionsAdapter.listCollectionPostIds({
        viewerId: viewer.viewerId,
        collectionId: params.collectionId,
        cursor: query.cursor ?? null,
        limit: query.limit,
      });
      const postIds = page.items.map((edge) => edge.postId);
      const items = await hydratePostCards(viewer.viewerId, postIds);
      return success({
        routeName: "collections.posts.get" as const,
        requestKey: `${params.collectionId}:${query.cursor ?? "start"}:${query.limit}`,
        page: {
          cursorIn: query.cursor ?? null,
          limit: query.limit,
          count: items.length,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          sort: "saved_at_desc" as const,
        },
        items,
        postIds,
        degraded: false,
        fallbacks: [],
      });
    } catch (error) {
      if (error instanceof Error && error.message === "collection_not_found") {
        return reply.status(404).send(failure("collection_not_found", "Collection not found"));
      }
      if (error instanceof Error && error.message === "invalid_cursor") {
        return reply.status(400).send(failure("invalid_cursor", "Cursor is invalid"));
      }
      throw error;
    }
  });

  app.post("/v2/collections/:collectionId/opened", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionParamsSchema.parse(request.params);
    setRouteName("collections.opened.post");
    const row = await collectionTelemetryRepository.recordOpened(viewer.viewerId, params.collectionId);
    return success({
      routeName: "collections.opened.post" as const,
      collectionId: params.collectionId,
      openCount: row.openCount,
      lastOpenedAtMs: row.lastOpenedAtMs
    });
  });

  app.post("/v2/collections/:collectionId/cover", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionParamsSchema.parse(request.params);
    setRouteName("collections.cover.post");
    let coverUri = "";
    const contentType = String(request.headers["content-type"] ?? "").toLowerCase();
    if (contentType.includes("multipart/form-data")) {
      const part = await request.file();
      if (!part) {
        return reply.status(400).send(failure("invalid_request", "cover file required"));
      }
      const cfg = getWasabiConfigOrNull();
      if (!cfg) {
        return reply.status(503).send(failure("storage_unavailable", "Wasabi configuration unavailable"));
      }
      const fileBuffer = await part.toBuffer();
      const destinationKey = `collections/covers/${viewer.viewerId}/${params.collectionId}/${Date.now()}.jpg`;
      const upload = await uploadPostSessionStagingFromBuffer(
        cfg,
        viewer.viewerId,
        `collection-cover-${params.collectionId}`,
        0,
        "photo",
        fileBuffer,
        { destinationKey, contentType: "image/jpeg" }
      );
      if (!upload.success) {
        return reply
          .status(500)
          .send(failure("cover_upload_failed", upload.error ?? "Failed to upload cover"));
      }
      coverUri = wasabiPublicUrlForKey(cfg, destinationKey);
    } else {
      const raw = CoverBodySchema.parse(request.body ?? {});
      coverUri = String(raw.coverUri ?? raw.url ?? raw.imageUrl ?? "").trim();
    }
    if (!coverUri) {
      return reply.status(400).send(failure("invalid_request", "cover URL or file required"));
    }
    const updated = await collectionsAdapter.updateCollection({
      viewerId: viewer.viewerId,
      collectionId: params.collectionId,
      updates: { coverUri }
    });
    if (!updated.collection) {
      return reply.status(404).send(failure("collection_not_found", "Collection not found"));
    }
    return success({
      routeName: "collections.cover.post" as const,
      collectionId: params.collectionId,
      displayPhotoUrl: updated.collection.coverUri ?? coverUri
    });
  });

  app.post("/v2/collections", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const body = CreateBodySchema.parse(request.body);
    setRouteName("collections.create.post");
    // invalidation: create invalidates viewer collection list, collection detail, and save-sheet projections.
    const created = await collectionsAdapter.createCollection({
      viewerId: viewer.viewerId,
      name: body.name,
      description: body.description,
      privacy: body.privacy,
      collaborators: body.collaborators,
      items: body.items,
      coverUri: body.coverUri,
      color: body.color,
    });
    return success({
      routeName: "collections.create.post" as const,
      collectionId: created.id,
      collection: created,
    });
  });

  app.patch("/v2/collections/:collectionId", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionParamsSchema.parse(request.params);
    const body = PatchBodySchema.parse(request.body);
    setRouteName("collections.update.post");
    // invalidation: update invalidates viewer collection list, collection detail, and any pinned collection previews.
    const updated = await collectionsAdapter.updateCollection({
      viewerId: viewer.viewerId,
      collectionId: params.collectionId,
      updates: body,
    });
    if (!updated.collection) {
      return reply.status(404).send(failure("collection_not_found", "Collection not found"));
    }
    return success({
      routeName: "collections.update.post" as const,
      collectionId: params.collectionId,
      updatedFields: updated.updatedFields,
      updatedCollection: updated.collection,
    });
  });

  app.delete("/v2/collections/:collectionId", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionParamsSchema.parse(request.params);
    setRouteName("collections.delete.post");
    // invalidation: delete invalidates viewer collection list, collection detail, and collection post pages.
    const deleted = await collectionsAdapter.deleteCollection({
      viewerId: viewer.viewerId,
      collectionId: params.collectionId,
    });
    if (!deleted.changed) {
      return reply.status(404).send(failure("collection_not_found", "Collection not found"));
    }
    return success({
      routeName: "collections.delete.post" as const,
      collectionId: params.collectionId,
      removed: true,
    });
  });

  app.post("/v2/collections/:collectionId/posts", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = CollectionParamsSchema.parse(request.params);
    const body = AddPostBodySchema.parse(request.body);
    setRouteName("collections.posts.add.post");
    // invalidation: collection membership add invalidates collection detail, collection posts, and viewer post save-state.
    const res = await collectionsAdapter.addPostToCollection({
      viewerId: viewer.viewerId,
      collectionId: params.collectionId,
      postId: body.postId,
    });
    const invalidation = queueEntityInvalidation("collection.posts.add", [
      entityCacheKeys.viewerPostState(viewer.viewerId, body.postId),
    ]);
    return success({
      routeName: "collections.posts.add.post" as const,
      collectionId: params.collectionId,
      postId: body.postId,
      added: res.changed,
      invalidation,
    });
  });

  app.delete("/v2/collections/:collectionId/posts/:postId", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = z
      .object({
        collectionId: z.string().trim().min(1),
        postId: z.string().trim().min(1),
      })
      .parse(request.params);
    setRouteName("collections.posts.remove.delete");
    // invalidation: collection membership remove invalidates collection detail, collection posts, and viewer post save-state.
    const res = await collectionsAdapter.removePostFromCollection({
      viewerId: viewer.viewerId,
      collectionId: params.collectionId,
      postId: params.postId,
    });
    const invalidation = queueEntityInvalidation("collection.posts.remove", [
      entityCacheKeys.viewerPostState(viewer.viewerId, params.postId),
    ]);
    return success({
      routeName: "collections.posts.remove.delete" as const,
      collectionId: params.collectionId,
      postId: params.postId,
      removed: res.changed,
      invalidation,
    });
  });

  app.get("/v2/posts/:postId/save-state", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = PostParamsSchema.parse(request.params);
    setRouteName("posts.save-state.get");
    const saveState = await collectionsAdapter.getPostSaveState({
      viewerId: viewer.viewerId,
      postId: params.postId,
    });
    return success({
      routeName: "posts.save-state.get" as const,
      postId: params.postId,
      saved: saveState.saved,
      collectionIds: saveState.collectionIds,
    });
  });

  app.post("/v2/posts/:postId/save", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = PostParamsSchema.parse(request.params);
    setRouteName("posts.save.post");
    const res = await collectionsAdapter.savePostToDefaultCollection({
      viewerId: viewer.viewerId,
      postId: params.postId,
    });
    const routeKeys = res.changed ? await invalidateSavedRouteCache(viewer.viewerId) : [];
    const invalidation = res.changed
      ? queueEntityInvalidation("post.save", [
          entityCacheKeys.viewerPostState(viewer.viewerId, params.postId),
        ])
      : { invalidatedKeysCount: 0, invalidationTypes: ["no_op_idempotent"] };
    if (routeKeys.length > 0) {
      recordInvalidation("route.collections.saved", { routeKeyCount: routeKeys.length });
      invalidation.invalidatedKeysCount += routeKeys.length;
      invalidation.invalidationTypes = [...new Set([...invalidation.invalidationTypes, "route.collections.saved"])];
    }
    return success({
      routeName: "posts.save.post" as const,
      postId: params.postId,
      saved: true,
      collectionId: res.collectionId,
      invalidation,
    });
  });

  app.post("/v2/posts/:postId/unsave", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const params = PostParamsSchema.parse(request.params);
    setRouteName("posts.unsave.post");
    const res = await collectionsAdapter.unsavePostFromDefaultCollection({
      viewerId: viewer.viewerId,
      postId: params.postId,
    });
    const routeKeys = res.changed ? await invalidateSavedRouteCache(viewer.viewerId) : [];
    const invalidation = res.changed
      ? queueEntityInvalidation("post.unsave", [
          entityCacheKeys.viewerPostState(viewer.viewerId, params.postId),
        ])
      : { invalidatedKeysCount: 0, invalidationTypes: ["no_op_idempotent"] };
    if (routeKeys.length > 0) {
      recordInvalidation("route.collections.saved", { routeKeyCount: routeKeys.length });
      invalidation.invalidatedKeysCount += routeKeys.length;
      invalidation.invalidationTypes = [...new Set([...invalidation.invalidationTypes, "route.collections.saved"])];
    }
    return success({
      routeName: "posts.unsave.post" as const,
      postId: params.postId,
      saved: false,
      collectionId: res.collectionId,
      invalidation,
    });
  });

  app.get("/v2/collections/save-sheet", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("collections", viewer.roles)) {
      return reply
        .status(403)
        .send(failure("v2_surface_disabled", "Collections v2 surface is not enabled for this viewer"));
    }
    const query = SaveSheetQuerySchema.parse(request.query);
    setRouteName("collections.save-sheet.get");
    const [collections, saveState] = await Promise.all([
      collectionsAdapter.listViewerCollections({ viewerId: viewer.viewerId, limit: 50 }),
      collectionsAdapter.getPostSaveState({
        viewerId: viewer.viewerId,
        postId: query.postId,
        limit: 50,
      }),
    ]);
    const selected = new Set(saveState.collectionIds);
    return success({
      routeName: "collections.save-sheet.get" as const,
      postId: query.postId,
      saved: saveState.saved,
      collectionIds: saveState.collectionIds,
      items: collections.map((row) => ({
        id: row.id,
        ownerId: row.ownerId,
        name: row.name,
        privacy: row.privacy,
        coverUri: row.coverUri,
        itemsCount: row.itemsCount,
        containsPost: selected.has(row.id),
      })),
    });
  });
}
