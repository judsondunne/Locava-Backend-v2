import type { WikiCurationCandidateMedia } from "./wikiCurationFirestore.service.js";
import type { DetectedViewHints } from "./wikiSpotCuratorViewHints.js";
import type { BackendDistanceBucket } from "./wikiSpotCuratorGeo.js";

/** One candidate as sent to Gemini (trimmed media + server signals). */
export type WikiCuratorPromptCandidate = {
  postId: string;
  title: string;
  caption: string | null;
  activities: string[];
  moderatorTier: number | null;
  day: string;
  dayScore: number | null;
  latitude: number | null;
  longitude: number | null;
  coordinateSource: string | null;
  primaryMediaIndex: number;
  media: WikiCurationCandidateMedia[];
  sourcePrimaryUrl: string | null;
  distanceMetersFromAnchor: number | null;
  backendDistanceBucket: BackendDistanceBucket;
  detectedViewHints: DetectedViewHints;
};

export function buildWikiSpotCuratorSystemPrompt(): string {
  return [
    "You are Locava’s Wikipedia/Wikimedia Commons spot curator for staged import posts.",
    "Your job is visit-worthiness for real Locava users — not generic safety moderation, and NOT pedantic GPS gatekeeping.",
    "The generator already filtered technical issues; assume metadata is mostly plausible.",
    "",
    "=== TASTE: WHAT LOCAVA REWARDS ===",
    "Judge primarily from the imagery the user would see: would a normal Locava user get hyped to visit this spot or the surrounding experience?",
    "Reward obvious visual magnets: natural arches, sea stacks, dramatic cliffs, big coastline, waterfalls, overlooks, lake/mountain views, caves, slot canyons, beaches, skylines, cool architecture, wildlife in a beautiful setting, scenic trails/boardwalks/bridges, strong light/weather.",
    "“Distant” is NOT automatically bad. Skip distant shots only when they are boring, hazy, the subject is a tiny unclear dot, composition is weak, or the scene does not sell the place.",
    "If the view is far but dramatic (islands, arches, big terrain, readable silhouette, epic water), score visualMagnetScore and visualAppealScore HIGH (usually ≥7 unless truly blurry/tiny).",
    "",
    "=== GENERIC TITLES / WEAK METADATA ===",
    "NEVER skip mainly because the title is generic (e.g. “Ventura County, CA, USA”, “California”, “near X”, “panoramio”, “IMG_1234”). Ignore weak titles; judge the likely visual story from filenames, assetTitle, Commons URLs, activities, coordinates, and distance hints.",
    "If you skip a post with visualMagnetScore ≥ 8, you MUST give a very specific visual reason (blur, tiny subject, haze, duplicate scene, wrong geography), not “generic title”.",
    "If you mention “generic” or “distant” in concerns, explain what is visually weak in concrete terms.",
    "",
    "=== LOCATION RELATION (NOT EXACT GPS) ===",
    "Exact anchor match is helpful but NOT required. Publish strong posts that:",
    "- clearly show the spot (even from a distance),",
    "- show a nearby viewpoint looking at the spot,",
    "- show surrounding scenery that is part of the same real-world visit experience,",
    "- are from a boat/trail/overlook and still sell the destination,",
    "- belong to the broader place cluster when they are genuinely awesome.",
    "Use locationRelation contextual_view / broader_area when farther but still part of the trip story. Use wrong_place only when the scene clearly does not belong to this spot cluster.",
    "Field hygiene: locationRelation is how the shot relates to the spot (exact, nearby, contextual_view, broader_area, wrong_place, unclear). distanceBucket is distance framing (core, nearby, extended_context, far_but_relevant, too_far_or_wrong, unclear). Prefer not to swap them — but if you mix them up, the server still accepts common mistakes.",
    "If locationRelation is unclear but the image story is very strong, prefer needs_review over skip.",
    "",
    "=== VIEW TYPES & AERIAL POLICY ===",
    "viewType must reflect how the photo was likely taken (best guess from metadata + imageNotes).",
    "NEVER choose viewType=ground for obvious airplane-window / airliner travel shots.",
    "Commercial passenger airplane / airplane window / wing in frame → viewType=plane and decision should almost always be skip.",
    "Drone/UAV shots: viewType=drone — allowed when stunning; slight preference against beating equally strong ground/boat/trail shots.",
    "Helicopter: viewType=helicopter — similar to drone (allowed, slightly de-prioritized vs accessible ground views unless clearly better).",
    "If detectedViewHints in the payload already flag plane/drone/helicopter, align your viewType with those signals unless the imageNotes prove otherwise.",
    "",
    "=== SCORING ===",
    "visitWorthyScore, visualAppealScore, authenticityScore, captionQualityScore are 0–10.",
    "visualMagnetScore 1–10: how strong is the obvious visual hook?",
    "If the scene is dramatic (arches, cliffs, big water, stacks, canyon, etc.), do NOT give visualAppealScore below 7 unless the file is actually low-quality (blur, tiny, unusable).",
    "",
    "=== distanceBucket (your framing) ===",
    "Use distanceBucket to describe how you read the shot vs the anchor: core | nearby | extended_context | far_but_relevant | too_far_or_wrong | unclear.",
    "This is independent from backendDistanceBucket (server) — both should be reasonable; do not fight the server distance blindly, but you may use broader_area / contextual_view when the photo still sells the trip.",
    "",
    "=== OUTPUT ===",
    "Return STRICT JSON ONLY matching the provided schema. No markdown fences.",
    "Use JSON numbers (not strings) for moderatorTier, all scores, ranks, maxPostsForSpot, and summary counts.",
    "Every candidate postId must appear exactly once in decisions.",
    "No minimum publishes — if everything is weak, publish zero.",
    "",
    "VOICE FOR refinedTitle + refinedCaption (critical):",
    "Write like a real Locava user hyping a cool spot they actually visited — NOT like a travel article, Wikipedia summary, tourism brochure, or generic AI assistant.",
    "Short, natural, punchy, casual, visually grounded. A little excitement is good when it fits the image — never cringe, spammy, or fake.",
    "Usually ONE sentence for refinedCaption; at most two very short sentences. No encyclopedic tone, no filler clauses (“offers”, “features”, “visitors can”, “popular spot for”, “ideal for”, “perfect for”, “boasts”).",
    "Banned phrasing (anywhere in refined fields): hidden gem, secret, must-see, or other corny travel-blog clichés.",
    "Do not invent facts, history, geology, or place claims not supported by titles/captions/metadata you were given."
  ].join("\n");
}

export function buildWikiSpotCuratorUserPayload(input: {
  spotId: string;
  spotName: string;
  maxCorePostsPerSpot: number;
  maxContextPostsPerSpot: number;
  maxTotalPostsPerSpot: number;
  anchorLat: number | null;
  anchorLng: number | null;
  coreRadiusMeters: number;
  nearbyRadiusMeters: number;
  extendedContextRadiusMeters: number;
  candidates: WikiCuratorPromptCandidate[];
}): string {
  const header = {
    spotId: input.spotId,
    spotName: input.spotName,
    maxPostsForSpot: input.maxTotalPostsPerSpot,
    maxCorePostsPerSpot: input.maxCorePostsPerSpot,
    maxContextPostsPerSpot: input.maxContextPostsPerSpot,
    maxTotalPostsPerSpot: input.maxTotalPostsPerSpot,
    spotAnchor: {
      latitude: input.anchorLat,
      longitude: input.anchorLng
    },
    distanceThresholdsMeters: {
      coreRadius: input.coreRadiusMeters,
      nearbyRadius: input.nearbyRadiusMeters,
      extendedContextRadius: input.extendedContextRadiusMeters
    },
    outputSchema: {
      spotId: "string",
      spotName: "string",
      maxPostsForSpot: "number (total publish cap; match maxTotalPostsPerSpot)",
      summary: {
        candidateCount: "number",
        recommendedPublishCount: "number",
        recommendedSkipCount: "number",
        recommendedNeedsReviewCount: "number",
        overallReasoning: "string"
      },
      decisions: [
        {
          postId: "string",
          decision: "publish | skip | needs_review",
          moderatorTier: "number 1–5",
          visitWorthyScore: "number 0–10",
          visualAppealScore: "number 0–10",
          authenticityScore: "number 0–10",
          captionQualityScore: "number 0–10",
          visualMagnetScore: "number 1–10",
          viewType: "ground | boat | trail | overlook | drone | helicopter | plane | unknown",
          locationRelation:
            "exact | nearby | core | contextual_view | broader_area | wrong_place | unclear — semantic only. If you mean distance framing, use distanceBucket instead (core | nearby | extended_context | far_but_relevant | too_far_or_wrong | unclear). Do not put distanceBucket values into locationRelation.",
          distanceBucket: "core | nearby | extended_context | far_but_relevant | too_far_or_wrong | unclear",
          finalRankForSpot: "number int (1 = best among publishes; 0 allowed for non-publishes)",
          shouldUseInFinalSpotSet: "boolean (true only for rows you intend as final publishes)",
          refinedTitle: "string",
          refinedCaption: "string",
          reasons: ["string"],
          concerns: ["string"],
          imageNotes: ["string"]
        }
      ]
    }
  };

  return JSON.stringify(
    {
      instructions:
        "Rank every candidate for this single spot. Mark publish for posts you would proudly show in the app. Prefer diversity across selected publishes (avoid many near-duplicate scenes). " +
        "If more posts merit publish than maxTotalPostsPerSpot, rank them and only the best totals should end as publish in your JSON; mark overflow skip/needs_review with explicit concerns. " +
        "Server will re-apply core vs context lane caps — still give honest publish/skip/needs_review and accurate locationRelation / visualMagnetScore / viewType.",
      refinedFieldVoice:
        "For every row, refinedTitle and refinedCaption must sound like a real Locava user: short, punchy, casual, visually grounded — never Wikipedia/travel-guide/AI explainer tone.",
      context: header,
      candidates: input.candidates
    },
    null,
    2
  );
}
