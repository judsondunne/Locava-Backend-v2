import type { SimpleFeedCandidate } from "../../repositories/surfaces/feed-for-you-simple.repository.js";

export function normalizeFeedPostId(input: {
  docId?: string | null;
  postId?: string | null;
  id?: string | null;
}): string | null {
  const docId = typeof input.docId === "string" ? input.docId.trim() : "";
  if (docId) return docId;
  const postId = typeof input.postId === "string" ? input.postId.trim() : "";
  if (postId) return postId;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  return id || null;
}

export function normalizeFeedPostIdFromCandidate(candidate: SimpleFeedCandidate): string | null {
  const raw = candidate.rawFirestore ?? {};
  return normalizeFeedPostId({
    docId: candidate.postId,
    postId: typeof raw.postId === "string" ? raw.postId : null,
    id: typeof raw.id === "string" ? raw.id : null
  });
}

export function canonicalizeFeedCandidate(candidate: SimpleFeedCandidate): SimpleFeedCandidate {
  const postId = normalizeFeedPostIdFromCandidate(candidate);
  if (!postId || postId === candidate.postId) return candidate;
  return {
    ...candidate,
    postId,
    rawFirestore: {
      ...(candidate.rawFirestore ?? {}),
      id: postId,
      postId
    }
  };
}
