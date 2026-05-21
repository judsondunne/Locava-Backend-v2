import type { WikiSpotCuratorDecisionRow } from "./wikiSpotCurator.schema.js";

export function normalizeCaptionKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 160);
}

export function primaryImageFingerprint(post: {
  media: { imageUrl?: string; sourceUrl?: string }[];
  primaryMediaIndex?: number;
}): string {
  const idx = typeof post.primaryMediaIndex === "number" ? post.primaryMediaIndex : 0;
  const m = post.media?.[idx] || post.media?.[0];
  const u = String(m?.imageUrl || m?.sourceUrl || "").trim();
  if (!u) return "";
  try {
    const url = new URL(u);
    return `${url.hostname}${url.pathname}`.toLowerCase().slice(0, 220);
  } catch {
    return u.toLowerCase().slice(0, 220);
  }
}

export type RankPostRef = {
  postId: string;
  media: { imageUrl?: string; sourceUrl?: string }[];
  primaryMediaIndex?: number;
  caption: string | null;
  title: string;
};

/**
 * After model output: among `publish` rows, walk best-first by finalRankForSpot.
 * - Dedupe near-identical primary image fingerprints (keep first / best rank).
 * - Cap total publishes to maxPostsForSpot; overflow becomes skip with explicit concern.
 */
export function enforcePublishCapAndDedupeFromPosts(
  decisions: WikiSpotCuratorDecisionRow[],
  postsById: Map<string, RankPostRef>,
  maxPostsForSpot: number
): WikiSpotCuratorDecisionRow[] {
  const out = decisions.map((d) => ({ ...d }));
  const ranked = [...out].sort((a, b) => a.finalRankForSpot - b.finalRankForSpot || a.postId.localeCompare(b.postId));

  const fpSeen = new Set<string>();
  let publishSlotsUsed = 0;

  for (const row of ranked) {
    if (row.decision !== "publish") continue;
    const ref = postsById.get(row.postId);
    const fp =
      primaryImageFingerprint({
        media: ref?.media || [],
        primaryMediaIndex: ref?.primaryMediaIndex
      }) || normalizeCaptionKey(`${ref?.title || ""}|${ref?.caption || ""}|${row.postId}`);
    if (fpSeen.has(fp)) {
      row.decision = "skip";
      row.shouldUseInFinalSpotSet = false;
      row.moderatorTier = row.moderatorTier <= 2 ? row.moderatorTier : 2;
      row.concerns = [
        ...row.concerns,
        "Near-duplicate scene vs a higher-ranked selected candidate for this spot (server dedupe)."
      ];
      continue;
    }
    fpSeen.add(fp);
    if (publishSlotsUsed >= maxPostsForSpot) {
      row.decision = "skip";
      row.shouldUseInFinalSpotSet = false;
      row.concerns = [
        ...row.concerns,
        `Lower-ranked than selected top ${maxPostsForSpot} publish candidates for this spot (maxPostsForSpot cap).`
      ];
      continue;
    }
    publishSlotsUsed += 1;
  }

  return out;
}
