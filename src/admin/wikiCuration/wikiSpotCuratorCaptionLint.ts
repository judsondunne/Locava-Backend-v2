import type { WikiSpotCuratorDecisionRow } from "./wikiSpotCurator.schema.js";

/** Brochure / travel-guide filler in `refinedCaption` — warn in dry-review only (does not block). */
export const REFINED_CAPTION_TRAVEL_GUIDE_SUBSTRINGS = [
  "offers",
  "popular spot",
  "perfect for",
  "ideal for",
  "features",
  "boasts",
  "visitors can"
] as const;

export type CaptionStyleWarning = {
  postId: string;
  patternsMatched: readonly string[];
};

function findPatternsInCaption(caption: string): string[] {
  const lower = String(caption || "").toLowerCase();
  const matched: string[] = [];
  for (const p of REFINED_CAPTION_TRAVEL_GUIDE_SUBSTRINGS) {
    if (lower.includes(p)) matched.push(p);
  }
  return matched;
}

/** Non-blocking hints for tuning prompts — attached to dry-review job result only. */
export function buildCaptionStyleWarningsForDryReview(decisions: WikiSpotCuratorDecisionRow[]): CaptionStyleWarning[] {
  const out: CaptionStyleWarning[] = [];
  for (const d of decisions) {
    const patternsMatched = findPatternsInCaption(d.refinedCaption);
    if (patternsMatched.length) {
      out.push({ postId: d.postId, patternsMatched });
    }
  }
  return out;
}
