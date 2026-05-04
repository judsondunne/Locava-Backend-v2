/**
 * Max assets read from Firestore `assets[]` onto feed candidates / cards.
 * Keeps payloads bounded while supporting multi-photo carousels (aligned with compact card cap).
 */
export const FEED_READ_NORMALIZED_ASSET_MAX = 24;
