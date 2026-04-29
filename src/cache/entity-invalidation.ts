import { buildCacheKey } from "./types.js";
import {
  deleteEntityCacheKeys,
  entityCacheKeys,
  getKnownAuthorUserIdForPost,
  getKnownPostIdsForAuthor,
  unlinkPostFromAuthorIndex
} from "./entity-cache.js";
import { globalCache } from "./global-cache.js";
import { invalidateRouteCacheByTags } from "./route-cache-index.js";
import { recordInvalidation } from "../observability/request-context.js";
import { MapMarkersFirestoreAdapter } from "../repositories/source-of-truth/map-markers-firestore.adapter.js";

export type MutationInvalidationInput =
  | {
      mutationType: "post.like";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "post.unlike";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "post.save";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "post.unsave";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "post.delete";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "user.follow";
      userId: string;
      viewerId: string;
      affectedAuthorPostLimit?: number;
    }
  | {
      mutationType: "user.unfollow";
      userId: string;
      viewerId: string;
      affectedAuthorPostLimit?: number;
    }
  | {
      mutationType: "posting.complete";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "comment.create";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "comment.delete";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "comment.like";
      postId: string;
      viewerId: string;
    }
  | {
      mutationType: "notification.create";
      viewerId: string;
    }
  | {
      mutationType: "notification.markread";
      viewerId: string;
    }
  | {
      mutationType: "notification.markallread";
      viewerId: string;
    }
  | {
      mutationType: "chat.markread";
      viewerId: string;
    }
  | {
      mutationType: "chat.markunread";
      viewerId: string;
    }
  | {
      mutationType: "chat.sendtext";
      viewerId: string;
      conversationId: string;
    }
  | {
      mutationType: "chat.reaction";
      viewerId: string;
      conversationId: string;
    }
  | {
      mutationType: "chat.message.delete";
      viewerId: string;
      conversationId: string;
    };

export type InvalidationResult = {
  mutationType: MutationInvalidationInput["mutationType"];
  invalidationTypes: string[];
  invalidatedKeys: string[];
};

export async function invalidateEntitiesForMutation(input: MutationInvalidationInput): Promise<InvalidationResult> {
  if (
    input.mutationType === "post.like" ||
    input.mutationType === "post.unlike" ||
    input.mutationType === "post.save" ||
    input.mutationType === "post.unsave"
  ) {
    const { postId, viewerId } = input;
    const entityKeys = [
      entityCacheKeys.postSocial(postId),
      entityCacheKeys.postCard(postId),
      entityCacheKeys.postDetail(postId),
      entityCacheKeys.viewerPostState(viewerId, postId)
    ];
    await deleteEntityCacheKeys(entityKeys);
    unlinkPostFromAuthorIndex(postId);

    const targetedRouteCacheKeys = [
      buildCacheKey("entity", ["feed-item-detail-v1", viewerId, postId]),
      ...deriveProfilePostDetailKeys(postId, viewerId)
    ];
    await Promise.all(targetedRouteCacheKeys.map((key) => globalCache.del(key)));

    const collectionsRouteKeys =
      input.mutationType === "post.save" || input.mutationType === "post.unsave"
        ? await invalidateRouteCacheByTags([`route:collections.saved:${viewerId}`])
        : [];
    const invalidatedKeys = [...entityKeys, ...targetedRouteCacheKeys, ...collectionsRouteKeys];
    recordInvalidation(input.mutationType, {
      entityKeyCount: entityKeys.length,
      routeKeyCount: targetedRouteCacheKeys.length + collectionsRouteKeys.length
    });
    return {
      mutationType: input.mutationType,
      invalidationTypes: [
        "post.social",
        "post.card",
        "post.detail",
        "post.viewer_state",
        "route.detail",
        ...(collectionsRouteKeys.length > 0 ? ["route.collections_saved"] : [])
      ],
      invalidatedKeys
    };
  }

  if (input.mutationType === "post.delete") {
    const { postId, viewerId } = input;
    MapMarkersFirestoreAdapter.invalidateSharedCache();
    const entityKeys = [
      entityCacheKeys.postSocial(postId),
      entityCacheKeys.postCard(postId),
      entityCacheKeys.postDetail(postId),
      entityCacheKeys.viewerPostState(viewerId, postId)
    ];
    await deleteEntityCacheKeys(entityKeys);
    unlinkPostFromAuthorIndex(postId);

    const targetedRouteCacheKeys = [
      buildCacheKey("entity", ["feed-item-detail-v1", viewerId, postId]),
      ...deriveProfilePostDetailKeys(postId, viewerId)
    ];
    await Promise.all(targetedRouteCacheKeys.map((key) => globalCache.del(key)));

    const visibilityRouteCacheKeys = derivePostingVisibilityRouteKeys(viewerId);
    await Promise.all(visibilityRouteCacheKeys.map((key) => globalCache.del(key)));
    const collectionsRouteKeys = await invalidateRouteCacheByTags([`route:collections.saved:${viewerId}`]);
    const mapBootstrapRouteKeys = await invalidateRouteCacheByTags([`route:map.bootstrap:${viewerId}`]);
    const invalidatedKeys = [
      ...entityKeys,
      ...targetedRouteCacheKeys,
      ...visibilityRouteCacheKeys,
      ...collectionsRouteKeys,
      ...mapBootstrapRouteKeys
    ];
    // Post delete affects the owner's profile counts + grid. In Locava v2, the deleter is expected
    // to be the owner, but we still defensively invalidate by parsed owner id when available.
    const ownerUserId = tryParseProfileUserIdFromPostId(postId) ?? viewerId;
    const profileRouteKeys = [
      buildCacheKey("entity", ["profile-header-v1", ownerUserId]),
      ...[6, 12, 18].map((previewLimit) =>
        buildCacheKey("list", ["profile-grid-preview-v1", ownerUserId, String(previewLimit)])
      ),
      ...[6, 8, 12, 24].map((limit) =>
        buildCacheKey("list", ["profile-grid-page-v2", viewerId, ownerUserId, "start", String(limit)])
      )
    ];
    await Promise.all(profileRouteKeys.map((key) => globalCache.del(key)));
    invalidatedKeys.push(...profileRouteKeys);
    recordInvalidation(input.mutationType, {
      entityKeyCount: entityKeys.length,
      routeKeyCount:
        targetedRouteCacheKeys.length +
        visibilityRouteCacheKeys.length +
        collectionsRouteKeys.length +
        mapBootstrapRouteKeys.length +
        profileRouteKeys.length
    });
    return {
      mutationType: input.mutationType,
      invalidationTypes: [
        "post.social",
        "post.card",
        "post.detail",
        "post.viewer_state",
        "route.detail",
        "route.feed_bootstrap",
        "route.profile_bootstrap",
        "route.profile_grid",
        "profile.header",
        "profile.grid_preview",
        "profile.grid_page",
        "route.map_bootstrap",
        "route.map_markers",
        ...(collectionsRouteKeys.length > 0 ? ["route.collections_saved"] : [])
      ],
      invalidatedKeys
    };
  }

  if (input.mutationType === "posting.complete") {
    const { postId, viewerId } = input;
    MapMarkersFirestoreAdapter.invalidateSharedCache();
    const entityKeys = [
      entityCacheKeys.postSocial(postId),
      entityCacheKeys.postCard(postId),
      entityCacheKeys.postDetail(postId),
      entityCacheKeys.viewerPostState(viewerId, postId)
    ];
    await deleteEntityCacheKeys(entityKeys);
    const targetedRouteCacheKeys = [
      buildCacheKey("entity", ["feed-item-detail-v1", viewerId, postId]),
      ...deriveProfilePostDetailKeys(postId, viewerId)
    ];
    await Promise.all(targetedRouteCacheKeys.map((key) => globalCache.del(key)));

    const visibilityRouteCacheKeys = derivePostingVisibilityRouteKeys(viewerId);
    await Promise.all(visibilityRouteCacheKeys.map((key) => globalCache.del(key)));
    const mapBootstrapRouteKeys = await invalidateRouteCacheByTags([`route:map.bootstrap:${viewerId}`]);
    const invalidatedKeys = [...entityKeys, ...targetedRouteCacheKeys, ...visibilityRouteCacheKeys, ...mapBootstrapRouteKeys];
    // Posting completion creates a new post for the owner, changing profile counts + grid.
    const ownerUserId = tryParseProfileUserIdFromPostId(postId) ?? viewerId;
    const profileRouteKeys = [
      buildCacheKey("entity", ["profile-header-v1", ownerUserId]),
      ...[6, 12, 18].map((previewLimit) =>
        buildCacheKey("list", ["profile-grid-preview-v1", ownerUserId, String(previewLimit)])
      ),
      ...[6, 8, 12, 24].map((limit) =>
        buildCacheKey("list", ["profile-grid-page-v2", viewerId, ownerUserId, "start", String(limit)])
      )
    ];
    await Promise.all(profileRouteKeys.map((key) => globalCache.del(key)));
    invalidatedKeys.push(...profileRouteKeys);
    recordInvalidation(input.mutationType, {
      entityKeyCount: entityKeys.length,
      routeKeyCount: targetedRouteCacheKeys.length + visibilityRouteCacheKeys.length + mapBootstrapRouteKeys.length + profileRouteKeys.length
    });
    return {
      mutationType: input.mutationType,
      invalidationTypes: [
        "post.social",
        "post.card",
        "post.detail",
        "post.viewer_state",
        "route.detail",
        "route.feed_bootstrap",
        "route.profile_bootstrap",
        "route.profile_grid",
        "profile.header",
        "profile.grid_preview",
        "profile.grid_page",
        "route.map_bootstrap",
        "route.map_markers"
      ],
      invalidatedKeys
    };
  }

  if (
    input.mutationType === "comment.create" ||
    input.mutationType === "comment.delete" ||
    input.mutationType === "comment.like"
  ) {
    const { postId, viewerId } = input;
    const entityKeys = [entityCacheKeys.postDetail(postId), entityCacheKeys.postSocial(postId)];
    const targetedRouteCacheKeys = [
      buildCacheKey("entity", ["feed-item-detail-v1", viewerId, postId]),
      ...deriveProfilePostDetailKeys(postId, viewerId)
    ];
    const invalidatedKeys = [...entityKeys, ...targetedRouteCacheKeys];
    recordInvalidation(input.mutationType, {
      entityKeyCount: entityKeys.length,
      routeKeyCount: targetedRouteCacheKeys.length + 1
    });
    void (async () => {
      await deleteEntityCacheKeys(entityKeys);
      await Promise.all(targetedRouteCacheKeys.map((key) => globalCache.del(key)));
      await invalidateRouteCacheByTags([`route:comments.list:${viewerId}:${postId}`, `route:comments.list:${viewerId}`]);
    })().catch(() => undefined);
    return {
      mutationType: input.mutationType,
      invalidationTypes: ["post.detail", "post.social", "route.detail", "route.comments"],
      invalidatedKeys
    };
  }

  if (
    input.mutationType === "notification.create" ||
    input.mutationType === "notification.markread" ||
    input.mutationType === "notification.markallread"
  ) {
    const listStartKeys = await invalidateRouteCacheByTags([`route:notifications.list:${input.viewerId}`]);
    recordInvalidation(input.mutationType, {
      entityKeyCount: 0,
      routeKeyCount: listStartKeys.length
    });
    return {
      mutationType: input.mutationType,
        invalidationTypes: ["route.notifications", "notifications.unread_count"],
      invalidatedKeys: listStartKeys
    };
  }

  if (input.mutationType === "chat.markread" || input.mutationType === "chat.markunread") {
    const listStartKeys = await invalidateRouteCacheByTags([`route:chats.inbox:${input.viewerId}`]);
    recordInvalidation(input.mutationType, {
      entityKeyCount: 0,
      routeKeyCount: listStartKeys.length
    });
    return {
      mutationType: input.mutationType,
      invalidationTypes: ["route.chats_inbox", "chats.unread_count"],
      invalidatedKeys: listStartKeys
    };
  }

  if (
    input.mutationType === "chat.sendtext" ||
    input.mutationType === "chat.reaction" ||
    input.mutationType === "chat.message.delete"
  ) {
    const keys = await invalidateRouteCacheByTags(
      [
        `route:chats.inbox:${input.viewerId}`,
        `route:chats.thread:${input.viewerId}:${input.conversationId}`,
        `route:chats.thread:${input.viewerId}`
      ],
      { deferIndexCleanup: true }
    );
    recordInvalidation(input.mutationType, {
      entityKeyCount: 0,
      routeKeyCount: keys.length
    });
    return {
      mutationType: input.mutationType,
      invalidationTypes: ["route.chats_thread", "route.chats_inbox"],
      invalidatedKeys: keys
    };
  }

  const { userId, viewerId } = input;
  const baseKeys = [
    entityCacheKeys.userSummary(userId),
    entityCacheKeys.userFirestoreDoc(userId),
    entityCacheKeys.userFollowCounts(userId),
    entityCacheKeys.userSummary(viewerId),
    entityCacheKeys.userFirestoreDoc(viewerId),
    entityCacheKeys.userFollowCounts(viewerId)
  ];
  const profileHeaderKeys = [
    buildCacheKey("entity", ["profile-header-v1", userId]),
    buildCacheKey("entity", ["profile-header-v1", viewerId])
  ];
  const profileGridPreviewKeys: string[] = [6, 12, 18].map((previewLimit) =>
    buildCacheKey("list", ["profile-grid-preview-v1", userId, String(previewLimit)])
  );
  const selfGridPreviewKeys: string[] = [6, 12, 18].map((previewLimit) =>
    buildCacheKey("list", ["profile-grid-preview-v1", viewerId, String(previewLimit)])
  );
  const profileGridPageStartKeys: string[] = [6, 8, 12, 24].map((limit) =>
    buildCacheKey("list", ["profile-grid-page-v2", viewerId, userId, "start", String(limit)])
  );
  const selfGridPageStartKeys: string[] = [6, 8, 12, 24].map((limit) =>
    buildCacheKey("list", ["profile-grid-page-v2", viewerId, viewerId, "start", String(limit)])
  );
  const affectedPostIds = getKnownPostIdsForAuthor(userId, input.affectedAuthorPostLimit ?? 48);
  const viewerStateKeys = affectedPostIds.map((postId) => entityCacheKeys.viewerPostState(viewerId, postId));
  const relationshipKeys = [
    buildCacheKey("entity", ["profile-relationship-v1", viewerId, userId])
  ];
  const bootstrapKeys = [6, 12, 18].map((previewLimit) =>
    buildCacheKey("bootstrap", ["profile-bootstrap-v1", viewerId, userId, String(previewLimit)])
  );
  // Follow/unfollow changes the viewer's own "following" count; clear self bootstrap too so profile header updates
  // even if the mutation happened while viewing another user.
  const selfBootstrapKeys = [6, 12, 18].map((previewLimit) =>
    buildCacheKey("bootstrap", ["profile-bootstrap-v1", viewerId, viewerId, String(previewLimit)])
  );
  await deleteEntityCacheKeys(baseKeys);
  await Promise.all(
    [
      ...profileHeaderKeys,
      ...profileGridPreviewKeys,
      ...selfGridPreviewKeys,
      ...profileGridPageStartKeys,
      ...selfGridPageStartKeys,
      ...relationshipKeys,
      ...bootstrapKeys,
      ...selfBootstrapKeys
    ].map((key) => globalCache.del(key))
  );
  if (viewerStateKeys.length > 0) {
    void deleteEntityCacheKeys(viewerStateKeys).catch(() => undefined);
  }
  const invalidatedKeys = [
    ...baseKeys,
    ...viewerStateKeys,
    ...profileHeaderKeys,
    ...profileGridPreviewKeys,
    ...selfGridPreviewKeys,
    ...profileGridPageStartKeys,
    ...selfGridPageStartKeys,
    ...relationshipKeys,
    ...bootstrapKeys,
    ...selfBootstrapKeys
  ];
  recordInvalidation(input.mutationType, {
    entityKeyCount: baseKeys.length + viewerStateKeys.length,
    routeKeyCount:
      profileHeaderKeys.length +
      profileGridPreviewKeys.length +
      selfGridPreviewKeys.length +
      profileGridPageStartKeys.length +
      selfGridPageStartKeys.length +
      relationshipKeys.length +
      bootstrapKeys.length +
      selfBootstrapKeys.length
  });
  return {
    mutationType: input.mutationType,
    invalidationTypes: [
      "user.summary",
      "user.firestore_doc",
      "author_post.viewer_state",
      "profile.header",
      "profile.grid_preview",
      "profile.grid_page",
      "profile.relationship",
      "route.profile_bootstrap"
    ],
    invalidatedKeys
  };
}

function deriveProfilePostDetailKeys(postId: string, viewerId: string): string[] {
  const candidates = new Set<string>();
  candidates.add(viewerId);
  const knownAuthor = getKnownAuthorUserIdForPost(postId);
  if (knownAuthor) {
    candidates.add(knownAuthor);
  }
  const parsedAuthor = tryParseProfileUserIdFromPostId(postId);
  if (parsedAuthor) {
    candidates.add(parsedAuthor);
  }
  return [...candidates].map((profileUserId) =>
    buildCacheKey("entity", ["profile-post-detail-v1", profileUserId, postId, viewerId])
  );
}

function derivePostingVisibilityRouteKeys(viewerId: string): string[] {
  const keys = new Set<string>();

  for (const limit of [4, 6, 8]) {
    keys.add(buildCacheKey("bootstrap", ["feed-bootstrap-v1", viewerId, "explore", "_", "_", "_", String(limit)]));
    keys.add(buildCacheKey("list", ["feed-candidates-v1", viewerId, "explore", "_", "_", "_", String(limit)]));
    keys.add(buildCacheKey("list", ["feed-page-v1", viewerId, "explore", "_", "_", "_", "start", String(limit)]));
  }

  for (const previewLimit of [4, 6]) {
    keys.add(buildCacheKey("bootstrap", ["profile-bootstrap-v1", viewerId, viewerId, String(previewLimit)]));
    keys.add(buildCacheKey("list", ["profile-grid-preview-v1", viewerId, String(previewLimit)]));
  }

  for (const limit of [6, 8, 12, 24]) {
    keys.add(buildCacheKey("list", ["profile-grid-page-v2", viewerId, viewerId, "start", String(limit)]));
  }

  for (const limit of [20, 120, 240, 400]) {
    keys.add(`map:markers:v2:${limit}`);
  }
  keys.add("map:markers:v2:all");
  keys.add("map:markers:v1");

  return [...keys];
}

function tryParseProfileUserIdFromPostId(postId: string): string | null {
  const marker = "-post-";
  const idx = postId.indexOf(marker);
  if (idx <= 0) return null;
  const userId = postId.slice(0, idx).trim();
  return userId.length > 0 ? userId : null;
}
