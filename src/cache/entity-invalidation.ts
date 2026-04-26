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

  if (input.mutationType === "posting.complete") {
    const { postId, viewerId } = input;
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
    const invalidatedKeys = [...entityKeys, ...targetedRouteCacheKeys, ...visibilityRouteCacheKeys];
    recordInvalidation(input.mutationType, {
      entityKeyCount: entityKeys.length,
      routeKeyCount: targetedRouteCacheKeys.length + visibilityRouteCacheKeys.length
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

  if (input.mutationType === "chat.sendtext" || input.mutationType === "chat.reaction") {
    const inboxStartKeys = await invalidateRouteCacheByTags([`route:chats.inbox:${input.viewerId}`]);
    const threadStartKeys = await invalidateRouteCacheByTags([
      `route:chats.thread:${input.viewerId}:${input.conversationId}`,
      `route:chats.thread:${input.viewerId}`
    ]);
    const keys = [...inboxStartKeys, ...threadStartKeys];
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
  const baseKeys = [entityCacheKeys.userSummary(userId), entityCacheKeys.userFirestoreDoc(userId)];
  const affectedPostIds = getKnownPostIdsForAuthor(userId, input.affectedAuthorPostLimit ?? 48);
  const viewerStateKeys = affectedPostIds.map((postId) => entityCacheKeys.viewerPostState(viewerId, postId));
  await deleteEntityCacheKeys([...baseKeys, ...viewerStateKeys]);
  const invalidatedKeys = [...baseKeys, ...viewerStateKeys];
  recordInvalidation(input.mutationType, {
    entityKeyCount: invalidatedKeys.length,
    routeKeyCount: 0
  });
  return {
    mutationType: input.mutationType,
    invalidationTypes: ["user.summary", "author_post.viewer_state"],
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
    keys.add(buildCacheKey("list", ["profile-grid-page-v1", viewerId, "start", String(limit)]));
  }

  for (const limit of [20, 120, 240, 400]) {
    keys.add(`map:markers:v2:${limit}`);
  }
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
