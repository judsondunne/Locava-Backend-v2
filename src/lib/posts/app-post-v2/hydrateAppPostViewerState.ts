import type { Firestore } from "firebase-admin/firestore";
import type { AppPostV2, AppPostViewerStateV2 } from "../../../contracts/app-post-v2.contract.js";
import { POST_LIKES_SUBCOLLECTION } from "../master-post-v2/auditPostEngagementSourcesV2.js";
import { CollectionsFirestoreAdapter } from "../../../repositories/source-of-truth/collections-firestore.adapter.js";
import { getFirestoreSourceClient } from "../../../repositories/source-of-truth/firestore-client.js";
import { mutationStateRepository } from "../../../repositories/mutations/mutation-state.repository.js";

export type HydrateViewerDiagnosticsV2 = {
  likesHydrated: boolean;
  savesHydrated: boolean;
  followsHydrated: boolean;
  warnings: string[];
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Merge viewer-specific fields into a single {@link AppPostV2}. Prefer batch hydration for lists.
 */
export function hydrateAppPostViewerState(
  appPost: AppPostV2,
  viewerId: string | null | undefined,
  state: Partial<AppPostViewerStateV2>
): AppPostV2 {
  return {
    ...appPost,
    viewerState: {
      liked: state.liked ?? appPost.viewerState.liked,
      saved: state.saved ?? appPost.viewerState.saved,
      savedCollectionIds: state.savedCollectionIds ?? appPost.viewerState.savedCollectionIds,
      followsAuthor: state.followsAuthor ?? appPost.viewerState.followsAuthor
    }
  };
}

type BulkHydrateOptions = {
  /** Override Firestore client (defaults to {@link getFirestoreSourceClient}). */
  db?: Firestore | null;
  viewerId: string | null | undefined;
  /** Cap collections scan cost — one `listViewerCollections` call for the viewer. */
  collectionsScanLimit?: number;
};

async function loadFollowingAuthorIds(db: Firestore, viewerId: string, authorIds: string[]): Promise<Set<string>> {
  const following = new Set<string>();
  const uniqueAuthors = [...new Set(authorIds.filter(Boolean))];
  if (uniqueAuthors.length === 0) return following;

  for (const aid of uniqueAuthors) {
    if (mutationStateRepository.isFollowing(viewerId, aid)) following.add(aid);
  }

  try {
    const viewerSnap = await db.collection("users").doc(viewerId).get();
    const data = (viewerSnap.data() ?? {}) as { following?: unknown };
    if (Array.isArray(data.following)) {
      const raw = new Set(data.following.filter((v): v is string => typeof v === "string" && v.trim().length > 0));
      for (const aid of uniqueAuthors) {
        if (raw.has(aid)) following.add(aid);
      }
      return following;
    }
  } catch {
    /* fall through */
  }

  const snaps = await Promise.all(
    uniqueAuthors.map((targetUserId) => db.collection("users").doc(viewerId).collection("following").doc(targetUserId).get())
  );
  for (let i = 0; i < uniqueAuthors.length; i++) {
    const aid = uniqueAuthors[i];
    if (aid && snaps[i]?.exists) following.add(aid);
  }
  return following;
}

/**
 * Batch-hydrate viewer state for many posts with bounded reads:
 * - One collections listing (saved posts → collection IDs)
 * - Chunked parallel reads for `posts/{postId}/likes/{viewerId}` existence
 * - One viewer doc read (or N following doc probes) for author follow edges
 */
export async function hydrateAppPostsViewerState(
  appPosts: AppPostV2[],
  options: BulkHydrateOptions
): Promise<{ posts: AppPostV2[]; diagnostics: HydrateViewerDiagnosticsV2 }> {
  const viewerId = options.viewerId?.trim() || "";
  const diagnostics: HydrateViewerDiagnosticsV2 = {
    likesHydrated: false,
    savesHydrated: false,
    followsHydrated: false,
    warnings: []
  };

  if (!viewerId || viewerId === "anonymous") {
    return {
      posts: appPosts.map((p) => ({
        ...p,
        viewerState: { liked: false, saved: false, savedCollectionIds: [], followsAuthor: false }
      })),
      diagnostics
    };
  }

  const db = options.db ?? getFirestoreSourceClient();
  const postIds = [...new Set(appPosts.map((p) => p.id).filter(Boolean))];
  const authorIds = [...new Set(appPosts.map((p) => p.author.userId).filter((x): x is string => Boolean(x)))];

  const savesByPostId = new Map<string, string[]>();
  if (db) {
    try {
      const adapter = new CollectionsFirestoreAdapter();
      const cols = await adapter.listViewerCollections({
        viewerId,
        limit: options.collectionsScanLimit ?? 80
      });
      for (const col of cols) {
        for (const pid of col.items) {
          const id = String(pid ?? "").trim();
          if (!id) continue;
          const arr = savesByPostId.get(id) ?? [];
          if (!arr.includes(col.id)) arr.push(col.id);
          savesByPostId.set(id, arr);
        }
      }
      diagnostics.savesHydrated = true;
    } catch (e) {
      diagnostics.warnings.push(`collections_list_failed:${String((e as Error)?.message ?? e)}`);
    }
  } else {
    diagnostics.warnings.push("firestore_unavailable");
  }

  let likedPosts = new Set<string>();
  if (db) {
    try {
      const chunks = chunk(postIds, 40);
      for (const ids of chunks) {
        const snaps = await Promise.all(
          ids.map((postId) =>
            db
              .collection("posts")
              .doc(postId)
              .collection(POST_LIKES_SUBCOLLECTION)
              .doc(viewerId)
              .get()
              .then((s) => ({ postId, exists: s.exists }))
          )
        );
        for (const row of snaps) {
          if (row.exists) likedPosts.add(row.postId);
        }
      }
      diagnostics.likesHydrated = true;
    } catch (e) {
      diagnostics.warnings.push(`likes_batch_failed:${String((e as Error)?.message ?? e)}`);
    }
  }

  let followingAuthors = new Set<string>();
  if (db && authorIds.length > 0) {
    try {
      followingAuthors = await loadFollowingAuthorIds(db, viewerId, authorIds);
      diagnostics.followsHydrated = true;
    } catch (e) {
      diagnostics.warnings.push(`follow_edges_failed:${String((e as Error)?.message ?? e)}`);
    }
  }

  return {
    posts: appPosts.map((p) => {
      const savedCollectionIds = savesByPostId.get(p.id) ?? [];
      const liked =
        likedPosts.has(p.id) ||
        mutationStateRepository.hasViewerLikedPost(viewerId, p.id) ||
        p.viewerState.liked;
      const saved =
        savedCollectionIds.length > 0 ||
        mutationStateRepository.resolveViewerSavedPost(viewerId, p.id, false) ||
        p.viewerState.saved;
      const followsAuthor = p.author.userId ? followingAuthors.has(p.author.userId) : false;
      return hydrateAppPostViewerState(p, viewerId, {
        liked,
        saved,
        savedCollectionIds,
        followsAuthor
      });
    }),
    diagnostics
  };
}
