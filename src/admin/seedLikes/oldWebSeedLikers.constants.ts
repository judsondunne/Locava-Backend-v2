/**
 * Snapshot of `likeBoosterSetting/global.likers` used by Locava Web like-booster v1/v2.
 * Source of truth in production is that Firestore document; this list is a read-only fallback
 * for tests and when Firestore is unavailable.
 */
export const OLD_WEB_SEED_LIKER_IDS: readonly string[] = [
  "ajjvU9zftPZze88KHfCfh4VS4Mj1",
  "qQkjhy6OBvOJaNpn0ZSuj1s9oUl1",
  "SjsExHziu5dl38gdcAuQyNZwcu73",
  "tQZgXeWliyMooE3BcF1RW9zui7r1",
  "fzVlZW2hdSM96QeyfmKWZ1iCuLa2",
  "hFy3XmmPc0QlEjUWsXRyT4OH9WX2",
  "qPsQDOZa4dhujXsmAz3HIgnFgIS2",
  "V3DwtAZkU3henJ2tVFJFZFM2dDQ2",
  "93UziEW46NdmtNsYFSAFLu6wVu42",
  "r2sf63lyPmX53N4TOKWfCVYBdiN2",
  "gtMOE3ZyoGQCZXL8663C2h84uLH3",
  "7X68FuVCpfWqS4HrKdtqO3jeaGL2",
  "112F95ewmDSnBJs81D2LxRW89x53",
  "xiXkxPM3ErVsbQUAAqdN09Ti0lZ2",
  "Hg9r1gu6I8SCEA5P6tcKJN67g2O2",
  "zSxadeInokRgFgSg9OHcdzV7iQe2",
  "Q50jGVBHc8QKYU0PZ2xkwnGFKJm2",
  "google_106313189499125710920",
  "7rpIrVShfudIPS1ISHTOoG9BhQF2"
] as const;

export const LIKE_BOOSTER_SETTINGS_COLLECTION = "likeBoosterSetting";
export const LIKE_BOOSTER_SETTINGS_DOC_ID = "global";
