import type { Firestore } from "firebase-admin/firestore";
import { incrementDbOps } from "../../../observability/request-context.js";
import { readMaybeMillis } from "../../../repositories/source-of-truth/post-firestore-projection.js";
import type {
  MasterPostEngagementCommentsSourceV2,
  MasterPostEngagementLikesSourceV2,
  PostEngagementSourceAuditRecentLikerV2,
  PostEngagementSourceAuditV2
} from "../../../contracts/master-post-v2.types.js";

const RECENT_LIKES = 5;
const RECENT_COMMENTS = 5;

/** Production path: Backend V2 `PostMutationRepository` writes here. */
export const POST_LIKES_SUBCOLLECTION = "likes" as const;

/** Production path: `CommentsRepository` subcollection storage. */
export const POST_COMMENTS_SUBCOLLECTION = "comments" as const;

export function deriveEngagementSourceSelection(params: {
  rawPost: Record<string, unknown>;
  likesSubCount: number | null;
  likesQueryError: string | null;
  commentsSubCount: number | null;
  commentsQueryError: string | null;
}): Pick<PostEngagementSourceAuditV2, "recommendedCanonical" | "selectedSource" | "mismatches" | "warnings"> {
  const raw = params.rawPost;
  const likesArrayCount = Array.isArray(raw.likes) ? raw.likes.length : 0;
  const commentsArrayCount = Array.isArray(raw.comments) ? raw.comments.length : 0;

  const postLikeCount =
    pickFiniteNonNeg(raw.likeCount as unknown) ??
    pickFiniteNonNeg(raw.likesCount as unknown) ??
    null;
  const postCommentsCount =
    pickFiniteNonNeg(raw.commentsCount as unknown) ??
    pickFiniteNonNeg(raw.commentCount as unknown) ??
    null;

  let selectedLikes: MasterPostEngagementLikesSourceV2 = "none";
  let likeCount = 0;
  const warnings: string[] = [];
  const mismatches: string[] = [];

  if (params.likesQueryError) {
    warnings.push(`likes_subcollection_query_error:${params.likesQueryError}`);
  }
  if (params.commentsQueryError) {
    warnings.push(`comments_subcollection_query_error:${params.commentsQueryError}`);
  }

  if (params.likesSubCount !== null) {
    if (params.likesSubCount > 0) {
      selectedLikes = "subcollection";
      likeCount = params.likesSubCount;
    } else if (likesArrayCount > 0) {
      selectedLikes = "postDocArray";
      likeCount = likesArrayCount;
      warnings.push("likes_selected_legacy_post_doc_array_empty_subcollection");
    } else if (postLikeCount !== null && postLikeCount > 0) {
      selectedLikes = "postDocCount";
      likeCount = postLikeCount;
      warnings.push("likes_selected_post_doc_denormalized_count_empty_subcollection");
    } else {
      selectedLikes = "none";
      likeCount = 0;
    }
    if (postLikeCount !== null && params.likesSubCount !== postLikeCount) {
      mismatches.push(`likes_count_post_doc_${postLikeCount}_vs_subcollection_${params.likesSubCount}`);
    }
    if (likesArrayCount > 0 && params.likesSubCount !== likesArrayCount) {
      mismatches.push(`likes_array_len_${likesArrayCount}_vs_subcollection_${params.likesSubCount}`);
    }
  } else {
    if (likesArrayCount > 0) {
      selectedLikes = "postDocArray";
      likeCount = likesArrayCount;
      warnings.push("likes_subcollection_unreadable_using_legacy_array");
    } else if (postLikeCount !== null && postLikeCount > 0) {
      selectedLikes = "postDocCount";
      likeCount = postLikeCount;
      warnings.push("likes_subcollection_unreadable_using_denormalized_count");
    } else {
      selectedLikes = "none";
      likeCount = 0;
    }
  }

  let selectedComments: MasterPostEngagementCommentsSourceV2 = "none";
  let commentCount = 0;

  if (params.commentsSubCount !== null) {
    if (params.commentsSubCount > 0) {
      selectedComments = "subcollection";
      commentCount = params.commentsSubCount;
    } else if (commentsArrayCount > 0) {
      selectedComments = "postDocArray";
      commentCount = commentsArrayCount;
      warnings.push("comments_subcollection_empty_using_post_doc_array");
    } else {
      selectedComments = "subcollection";
      commentCount = 0;
    }
    if (postCommentsCount !== null && params.commentsSubCount !== postCommentsCount) {
      mismatches.push(`comments_count_post_doc_${postCommentsCount}_vs_subcollection_${params.commentsSubCount}`);
    }
    if (commentsArrayCount > 0 && params.commentsSubCount !== commentsArrayCount) {
      mismatches.push(`comments_array_len_${commentsArrayCount}_vs_subcollection_${params.commentsSubCount}`);
    }
  } else {
    if (commentsArrayCount > 0) {
      selectedComments = "postDocArray";
      commentCount = commentsArrayCount;
      warnings.push("comments_subcollection_unreadable_using_embedded_array");
    } else if (postCommentsCount !== null && postCommentsCount > 0) {
      selectedComments = "postDocCount";
      commentCount = postCommentsCount;
      warnings.push("comments_subcollection_unreadable_using_denormalized_count");
    } else {
      selectedComments = "none";
      commentCount = 0;
    }
  }

  const likesVersionRaw = pickFiniteNonNeg(raw.likesVersion as unknown);
  const commentsVersionRaw = pickFiniteNonNeg(raw.commentsVersion as unknown);

  return {
    selectedSource: { likes: selectedLikes, comments: selectedComments },
    recommendedCanonical: {
      likeCount,
      commentCount,
      likesVersion: likesVersionRaw ?? likeCount ?? null,
      commentsVersion: commentsVersionRaw ?? commentCount ?? null
    },
    mismatches,
    warnings
  };
}

export async function auditPostEngagementSourcesV2(db: Firestore, postId: string, rawPost: Record<string, unknown>): Promise<PostEngagementSourceAuditV2> {
  const likesPath = `posts/${postId}/${POST_LIKES_SUBCOLLECTION}`;
  const commentsPath = `posts/${postId}/${POST_COMMENTS_SUBCOLLECTION}`;

  const likesArrayCount = Array.isArray(rawPost.likes) ? rawPost.likes.length : 0;
  const commentsArrayCount = Array.isArray(rawPost.comments) ? rawPost.comments.length : 0;
  const postLikeCount =
    pickFiniteNonNeg(rawPost.likeCount as unknown) ?? pickFiniteNonNeg(rawPost.likesCount as unknown) ?? null;
  const postCommentsCount =
    pickFiniteNonNeg(rawPost.commentsCount as unknown) ??
    pickFiniteNonNeg(rawPost.commentCount as unknown) ??
    null;
  const likesVersion = pickFiniteNonNeg(rawPost.likesVersion as unknown);
  const commentsVersion = pickFiniteNonNeg(rawPost.commentsVersion as unknown);

  let likesSubCount: number | null = null;
  let likesQueryError: string | null = null;
  let recentLikersSub: PostEngagementSourceAuditRecentLikerV2[] = [];

  const postRef = db.collection("posts").doc(postId);
  const likesRef = postRef.collection(POST_LIKES_SUBCOLLECTION);

  try {
    const aggSnap = await likesRef.count().get();
    incrementDbOps("reads", 1);
    incrementDbOps("queries", 1);
    likesSubCount = typeof aggSnap.data().count === "number" ? Math.max(0, Math.floor(aggSnap.data().count)) : null;
  } catch (error) {
    likesQueryError = error instanceof Error ? error.message : String(error);
  }

  try {
    const qSnap = await likesRef.orderBy("createdAt", "desc").limit(RECENT_LIKES).get();
    incrementDbOps("reads", qSnap.size);
    incrementDbOps("queries", 1);
    recentLikersSub = qSnap.docs.map((d) => mapLikeDoc(d.id, (d.data() ?? {}) as Record<string, unknown>));
  } catch {
    try {
      const qSnap = await likesRef.limit(RECENT_LIKES).get();
      incrementDbOps("reads", qSnap.size);
      incrementDbOps("queries", 1);
      recentLikersSub = qSnap.docs.map((d) => mapLikeDoc(d.id, (d.data() ?? {}) as Record<string, unknown>));
      recentLikersSub.sort((a, b) => compareLikedAtDesc(a.likedAt, b.likedAt));
      recentLikersSub = recentLikersSub.slice(0, RECENT_LIKES);
    } catch (error2) {
      likesQueryError = likesQueryError ?? (error2 instanceof Error ? error2.message : String(error2));
      recentLikersSub = [];
    }
  }

  let commentsSubCount: number | null = null;
  let commentsQueryError: string | null = null;
  let recentComments: Array<Record<string, unknown>> = [];

  const commentsRef = postRef.collection(POST_COMMENTS_SUBCOLLECTION);

  try {
    const cAgg = await commentsRef.count().get();
    incrementDbOps("reads", 1);
    incrementDbOps("queries", 1);
    commentsSubCount = typeof cAgg.data().count === "number" ? Math.max(0, Math.floor(cAgg.data().count)) : null;
  } catch (error) {
    commentsQueryError = error instanceof Error ? error.message : String(error);
  }

  try {
    let cSnap = await commentsRef.limit(RECENT_COMMENTS).get();
    incrementDbOps("reads", cSnap.size);
    incrementDbOps("queries", 1);
    recentComments = cSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    recentComments.sort((a, b) => {
      const ma = Math.max(readMaybeMillis(a.createdAt) ?? 0, readMaybeMillis(a.createdAtMs) ?? 0, readMaybeMillis(a.time) ?? 0);
      const mb = Math.max(readMaybeMillis(b.createdAt) ?? 0, readMaybeMillis(b.createdAtMs) ?? 0, readMaybeMillis(b.time) ?? 0);
      return mb - ma;
    });
    recentComments = recentComments.slice(0, RECENT_COMMENTS);
  } catch (error2) {
    commentsQueryError = commentsQueryError ?? (error2 instanceof Error ? error2.message : String(error2));
    recentComments = [];
  }

  const derived = deriveEngagementSourceSelection({
    rawPost,
    likesSubCount,
    likesQueryError,
    commentsSubCount,
    commentsQueryError
  });

  return {
    postDoc: {
      likeCount: postLikeCount,
      likesArrayCount,
      commentsCount: postCommentsCount,
      commentsArrayCount,
      likesVersion,
      commentsVersion
    },
    subcollections: {
      likesPath,
      likesCount: likesSubCount,
      recentLikers: recentLikersSub,
      likesQueryError,
      commentsPath,
      commentsCount: commentsSubCount,
      recentComments,
      commentsQueryError
    },
    recommendedCanonical: derived.recommendedCanonical,
    selectedSource: derived.selectedSource,
    mismatches: derived.mismatches,
    warnings: derived.warnings
  };
}

function compareLikedAtDesc(a: string | null, b: string | null): number {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
  if (!Number.isFinite(ta)) return 1;
  if (!Number.isFinite(tb)) return -1;
  return tb - ta;
}

function mapLikeDoc(docId: string, data: Record<string, unknown>): PostEngagementSourceAuditRecentLikerV2 {
  const userId = typeof data.userId === "string" ? data.userId : docId;
  const displayName =
    typeof data.userName === "string"
      ? data.userName.trim()
      : typeof data.displayName === "string"
        ? data.displayName.trim()
        : typeof data.name === "string"
          ? data.name.trim()
          : null;
  const handle =
    typeof data.userHandle === "string" ? data.userHandle.trim() : typeof data.handle === "string" ? data.handle.trim() : null;
  const profilePicUrl =
    typeof data.userPic === "string"
      ? data.userPic.trim()
      : typeof data.profilePicUrl === "string"
        ? data.profilePicUrl.trim()
        : null;
  const likedAt = toIsoFromUnknown(data.createdAt ?? data.likedAt ?? data.updatedAt ?? data.time);
  return { userId, displayName, handle, profilePicUrl, likedAt };
}

function toIsoFromUnknown(value: unknown): string | null {
  const ms = readMaybeMillis(value);
  if (ms === null) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function pickFiniteNonNeg(value: unknown): number | null {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : typeof value === "string" && value.trim()
        ? Math.floor(Number(value))
        : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
