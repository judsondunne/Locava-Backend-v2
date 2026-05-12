/**
 * Central Firestore read budgets for routes reimplemented after read containment.
 * Do not raise these without an explicit capacity review.
 */
export const NOTIFICATIONS_LIST_MAX_DOCS = 30;
export const NOTIFICATIONS_META_MAX_DOCS = 1;
export const REEL_POOL_COLD_MAX_DOCS = 50;
/** Bounded cold fill for For You V5 in-memory ready deck (NOT the old per-request pool warmup). */
export const FOR_YOU_V5_REEL_DECK_MAX_DOCS = 250;
export const FOR_YOU_V5_REGULAR_RESERVOIR_MAX_DOCS = 400;
export const FOR_YOU_V5_REGULAR_RESERVOIR_BATCH = 40;
export const FOR_YOU_FALLBACK_MAX_DOCS = 30;
export const NEAR_ME_COLD_MAX_DOCS = 120;
export const STORY_USERS_COLD_MAX_DOCS = 40;
export const RECENT_POSTS_PAGE_MAX_DOCS = 30;
export const TOP_ACTIVITIES_COLD_FALLBACK_MAX_DOCS = 50;
