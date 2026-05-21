import { z } from "zod";

export const WikiSpotCuratorDecisionSchema = z.enum(["publish", "skip", "needs_review"]);

/** Gemini often returns numeric fields as strings; coerce so validation matches real model output. */
const score0to10 = z.coerce.number().min(0).max(10);
const moderatorTier1to5 = z.coerce
  .number()
  .int()
  .refine((n) => n >= 1 && n <= 5, { message: "moderatorTier must be integer 1–5" });

export const WikiSpotCuratorViewTypeSchema = z.enum([
  "ground",
  "boat",
  "trail",
  "overlook",
  "drone",
  "helicopter",
  "plane",
  "unknown"
]);

export const WikiSpotCuratorLocationRelationSchema = z.enum([
  "exact",
  "nearby",
  "contextual_view",
  "broader_area",
  "wrong_place",
  "unclear",
  /** Model often confuses these with `distanceBucket` — accept and treat server-side. */
  "extended_context",
  "far_but_relevant",
  "too_far_or_wrong",
  "core"
]);

/** Model’s distance framing (may disagree with server buckets). */
export const WikiSpotCuratorAiDistanceBucketSchema = z.enum([
  "core",
  "nearby",
  "extended_context",
  "far_but_relevant",
  "too_far_or_wrong",
  "unclear"
]);

export const WikiSpotCuratorBackendDistanceBucketSchema = z.enum([
  "core",
  "nearby",
  "extended_context",
  "too_far_or_wrong",
  "unclear"
]);

export const WikiSpotCuratorSelectionLaneSchema = z.enum(["core", "context", "skipped", "not_selected"]);

export const WikiSpotCuratorDecisionRowSchema = z.object({
  postId: z.string().min(1),
  decision: WikiSpotCuratorDecisionSchema,
  moderatorTier: moderatorTier1to5,
  visitWorthyScore: score0to10,
  visualAppealScore: score0to10,
  authenticityScore: score0to10,
  captionQualityScore: score0to10,
  /** Gemini often uses 0 for skip/needs_review; we normalize to ≥1 before ranking logic. */
  finalRankForSpot: z.coerce.number().int().min(0),
  shouldUseInFinalSpotSet: z.boolean(),
  refinedTitle: z.string(),
  refinedCaption: z.string(),
  reasons: z.array(z.string()),
  concerns: z.array(z.string()),
  imageNotes: z.array(z.string()),
  viewType: WikiSpotCuratorViewTypeSchema.optional().default("unknown"),
  visualMagnetScore: score0to10.optional().default(5),
  locationRelation: WikiSpotCuratorLocationRelationSchema.optional().default("unclear"),
  distanceBucket: WikiSpotCuratorAiDistanceBucketSchema.optional().default("unclear"),
  /** Server-filled after parse (meters from spot anchor). */
  distanceMetersFromAnchor: z.coerce.number().finite().nullable().optional(),
  /** Server-filled from haversine + thresholds. */
  backendDistanceBucket: WikiSpotCuratorBackendDistanceBucketSchema.optional(),
  selectionLane: WikiSpotCuratorSelectionLaneSchema.optional(),
  countsAgainstCoreMax: z.boolean().optional(),
  curationWarnings: z.array(z.string()).optional()
});

export const WikiSpotCuratorSummarySchema = z.object({
  candidateCount: z.coerce.number().int().min(0),
  recommendedPublishCount: z.coerce.number().int().min(0),
  recommendedPublishCoreCount: z.coerce.number().int().min(0).optional(),
  recommendedPublishContextCount: z.coerce.number().int().min(0).optional(),
  recommendedSkipCount: z.coerce.number().int().min(0),
  recommendedNeedsReviewCount: z.coerce.number().int().min(0),
  overallReasoning: z.string(),
  maxCorePostsPerSpot: z.coerce.number().int().min(0).max(30).optional(),
  maxContextPostsPerSpot: z.coerce.number().int().min(0).max(30).optional(),
  maxTotalPostsPerSpot: z.coerce.number().int().min(0).max(40).optional()
});

export const WikiSpotCuratorAiResponseSchema = z
  .object({
    spotId: z.string().min(1),
    spotName: z.string(),
    /** Legacy cap; server maps this to maxTotal when older clients send only this. */
    maxPostsForSpot: z.coerce.number().int().min(0).max(40),
    summary: WikiSpotCuratorSummarySchema,
    decisions: z.array(WikiSpotCuratorDecisionRowSchema)
  })
  .passthrough();

export const WikiCurationUsageSchema = z.object({
  provider: z.literal("gemini"),
  model: z.string(),
  candidateCount: z.coerce.number().int().min(0),
  imageCount: z.coerce.number().int().min(0),
  maxImagesPerCandidate: z.coerce.number().int().min(0).optional(),
  estimatedInputTokens: z.coerce.number().int().min(0).optional(),
  promptTokenCount: z.coerce.number().int().min(0).optional(),
  candidatesTokenCount: z.coerce.number().int().min(0).optional(),
  totalTokenCount: z.coerce.number().int().min(0).optional(),
  estimatedCostUsd: z.coerce.number().finite().optional(),
  pricingSource: z.enum(["config", "unknown"]).optional(),
  freshCall: z.boolean()
});

export type WikiSpotCuratorSummary = z.infer<typeof WikiSpotCuratorSummarySchema>;

export type WikiSpotCuratorAiResponse = z.infer<typeof WikiSpotCuratorAiResponseSchema>;
export type WikiSpotCuratorDecisionRow = z.infer<typeof WikiSpotCuratorDecisionRowSchema>;
export type WikiCurationUsage = z.infer<typeof WikiCurationUsageSchema>;

/** Server-added hints on dry-review completion (not produced by Gemini). */
export type WikiSpotCuratorDryReviewHints = {
  captionStyleWarnings: Array<{ postId: string; patternsMatched: string[] }>;
  decisionInspectionWarnings: Array<{ postId: string; message: string }>;
};

export type WikiSpotCuratorDryReviewJobResult = WikiSpotCuratorAiResponse & {
  dryReviewHints: WikiSpotCuratorDryReviewHints;
  usage?: WikiCurationUsage;
  /** Echo of request knobs for UI / apply auditing. */
  curationOptions?: {
    maxCorePostsPerSpot: number;
    maxContextPostsPerSpot: number;
    maxTotalPostsPerSpot: number;
    maxImagesPerCandidate: number;
    allowContextualFarRelevant: boolean;
    rejectPlaneViews: boolean;
    coreRadiusMeters: number;
    nearbyRadiusMeters: number;
    extendedContextRadiusMeters: number;
  };
};
