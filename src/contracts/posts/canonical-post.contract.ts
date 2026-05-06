import type { AppPostV2 } from "../app-post-v2.contract.js";

/**
 * Canonical post contract for all post-returning APIs.
 * During migration, `appPost`/`appPostV2` are compatibility mirrors only.
 */
export type CanonicalPost = AppPostV2;

export type CanonicalPostEnvelope = {
  postContractVersion: 3;
  post: CanonicalPost;
  canonicalPost: CanonicalPost;
  appPost: CanonicalPost;
  appPostV2: CanonicalPost;
};

export type CanonicalPostsEnvelope = {
  postContractVersion: 3;
  posts: CanonicalPost[];
};
