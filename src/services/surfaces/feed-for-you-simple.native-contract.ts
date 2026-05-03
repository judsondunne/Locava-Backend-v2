/**
 * Reference semantics for native clients consuming `/v2/feed/for-you/simple`.
 * Keep in sync with product UX (empty states must not flash on transient zeros).
 */

export type ForYouSimpleClientFeedState = {
  /** Stable ordered post ids currently shown */
  postIds: string[];
  /** Whether to show the true-empty ("no posts in database") surface */
  showTrueEmpty: boolean;
};

export type ForYouSimplePageLike = {
  items: Array<{ postId: string }>;
  exhausted: boolean;
  emptyReason: string | null;
  /** Requested page size (limit query param) */
  requestedLimit: number;
};

export function reduceForYouSimplePage(prev: ForYouSimpleClientFeedState, page: ForYouSimplePageLike): ForYouSimpleClientFeedState {
  if (page.items.length === 0 && page.emptyReason !== "no_playable_posts") {
    return {
      postIds: prev.postIds,
      showTrueEmpty: false
    };
  }
  if (page.items.length === 0 && page.emptyReason === "no_playable_posts") {
    return {
      postIds: [],
      showTrueEmpty: true
    };
  }
  return {
    postIds: page.items.map((i) => i.postId),
    showTrueEmpty: false
  };
}

/** "All out" / end-of-inventory messaging should not trigger on short pages. */
export function shouldShowAllOutCopy(page: ForYouSimplePageLike): boolean {
  if (page.items.length === 0) return false;
  return page.exhausted === true && page.items.length >= page.requestedLimit;
}
