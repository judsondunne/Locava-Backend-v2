import { globalCache } from "./global-cache.js";
import { recordEntityCacheHit, recordEntityCacheMiss } from "../observability/request-context.js";

const authorPostIndex = new Map<string, Set<string>>();
const postAuthorIndex = new Map<string, string>();

export const entityCacheKeys = {
  postCard(postId: string): string {
    return `post:${postId}:card`;
  },
  postDetail(postId: string): string {
    return `post:${postId}:detail`;
  },
  postSocial(postId: string): string {
    return `post:${postId}:social`;
  },
  userSummary(userId: string): string {
    return `user:${userId}:summary`;
  },
  /** Raw `users/{id}` document data; separate from `userSummary` to avoid shape collisions. */
  userFirestoreDoc(userId: string): string {
    return `user:${userId}:firestoreDoc`;
  },
  userPostCount(userId: string): string {
    return `user:${userId}:postCount`;
  },
  notificationsUnreadCount(userId: string): string {
    return `user:${userId}:notificationsUnreadCount`;
  },
  notificationsReadAllAt(userId: string): string {
    return `user:${userId}:notificationsReadAllAt`;
  },
  chatConversationMembership(viewerId: string, conversationId: string): string {
    return `chat:${conversationId}:viewer:${viewerId}:membership`;
  },
  chatDirectConversation(pairKey: string): string {
    return `chat:direct:${pairKey}:conversationId`;
  },
  viewerPostState(viewerId: string, postId: string): string {
    return `post:${postId}:viewer:${viewerId}:state`;
  }
};

export async function getOrSetEntityCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = await globalCache.get<T>(key);
  if (cached !== undefined) {
    recordEntityCacheHit();
    return cached;
  }
  recordEntityCacheMiss();
  const loaded = await loader();
  await globalCache.set(key, loaded, ttlMs);
  indexEntityForInvalidation(key, loaded);
  return loaded;
}

export async function deleteEntityCacheKeys(keys: string[]): Promise<void> {
  const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  await Promise.all(unique.map((key) => globalCache.del(key)));
}

export function getKnownPostIdsForAuthor(authorUserId: string, limit = 60): string[] {
  const set = authorPostIndex.get(authorUserId);
  if (!set) return [];
  return [...set].slice(0, Math.max(1, limit));
}

export function unlinkPostFromAuthorIndex(postId: string): void {
  const authorUserId = postAuthorIndex.get(postId);
  if (!authorUserId) return;
  postAuthorIndex.delete(postId);
  const set = authorPostIndex.get(authorUserId);
  if (!set) return;
  set.delete(postId);
  if (set.size === 0) {
    authorPostIndex.delete(authorUserId);
  }
}

export function getKnownAuthorUserIdForPost(postId: string): string | null {
  return postAuthorIndex.get(postId) ?? null;
}

function indexEntityForInvalidation(key: string, value: unknown): void {
  if (!key.endsWith(":card")) return;
  if (typeof value !== "object" || value === null) return;
  const maybe = value as {
    postId?: unknown;
    author?: { userId?: unknown };
  };
  const postId = typeof maybe.postId === "string" ? maybe.postId : null;
  const authorUserId = typeof maybe.author?.userId === "string" ? maybe.author.userId : null;
  if (!postId || !authorUserId) return;
  postAuthorIndex.set(postId, authorUserId);
  const set = authorPostIndex.get(authorUserId) ?? new Set<string>();
  set.add(postId);
  authorPostIndex.set(authorUserId, set);
}
