import { z } from "zod";
import { defineContract } from "../conventions.js";
import { AchievementDeltaSchema, LegendRewardEnvelopeSchema } from "../entities/achievement-entities.contract.js";
import { PostMediaReadinessSchema } from "../entities/post-entities.contract.js";

/** Fastify `bodyLimit` for POST /v2/posting/finalize — must exceed worst-case JSON for base64 fields below. */
const DISPLAY_PHOTO_B64_MAX = 6_000_000;
const VIDEO_POSTER_B64_MAX_EACH = 2_500_000;
const VIDEO_POSTER_SLOTS = 20;
export const POSTING_FINALIZE_BODY_LIMIT_BYTES = Math.ceil(
  (DISPLAY_PHOTO_B64_MAX + VIDEO_POSTER_SLOTS * VIDEO_POSTER_B64_MAX_EACH + 512_000) * 1.05
);

const LetterboxGradientSourceSchema = z.enum(["calculated", "placeholder", "global", "blurhash"]);

const LetterboxGradientBodySchema = z.object({
  top: z.string().min(4).max(32),
  bottom: z.string().min(4).max(32),
  source: LetterboxGradientSourceSchema.optional()
});

const AssetPresentationBodySchema = z.object({
  letterboxGradient: LetterboxGradientBodySchema.optional(),
  carouselFitWidth: z.boolean().optional(),
  resizeMode: z.enum(["cover", "contain"]).optional()
});

const AssetPresentationSlotSchema = z.object({
  index: z.coerce.number().int().min(0).max(79),
  presentation: AssetPresentationBodySchema.optional()
});

export const PostingFinalizeBodySchema = z.object({
  sessionId: z.string().min(6),
  stagedSessionId: z.string().min(6).optional(),
  stagedItems: z
    .array(
      z.object({
        index: z.coerce.number().int().min(0).max(79),
        assetType: z.enum(["photo", "video"]),
        assetId: z.string().min(6).max(160).optional(),
        originalKey: z.string().min(4).max(256).optional(),
        originalUrl: z.string().url().optional(),
        posterKey: z.string().min(4).max(256).optional(),
        posterUrl: z.string().url().optional()
      })
    )
    .max(20)
    .optional(),
  idempotencyKey: z.string().min(8).max(128),
  mediaCount: z.coerce.number().int().min(1).max(20).default(1),
  userId: z.string().min(3).optional(),
  title: z.string().max(300).optional(),
  content: z.string().max(5000).optional(),
  activities: z.array(z.string().max(128)).max(20).default([]),
  lat: z.union([z.number(), z.string()]).optional(),
  long: z.union([z.number(), z.string()]).optional(),
  address: z.string().max(500).optional(),
  privacy: z.string().max(64).optional(),
  tags: z.array(z.record(z.string(), z.unknown())).optional(),
  texts: z.array(z.unknown()).optional(),
  recordings: z.array(z.unknown()).optional(),
  displayPhotoBase64: z.string().max(DISPLAY_PHOTO_B64_MAX).optional(),
  videoPostersBase64: z.array(z.string().max(VIDEO_POSTER_B64_MAX_EACH).nullable()).max(VIDEO_POSTER_SLOTS).optional(),
  /** Optional: legends staged preview id to commit after post creation. */
  legendStageId: z.string().min(8).max(128).optional(),
  /** Native carousel fit-to-width (letterbox) — stored on canonical post. */
  carouselFitWidth: z.boolean().optional(),
  /** Post-level letterbox gradients (top → bottom per slide or broadcast when length is 1). */
  letterboxGradients: z.array(LetterboxGradientBodySchema).max(20).optional(),
  /** Per-asset presentation hints aligned by `index` (same ordering as `stagedItems`). */
  assetPresentations: z.array(AssetPresentationSlotSchema).max(20).optional()
});

export const PostingFinalizeResponseSchema = z.object({
  routeName: z.literal("posting.finalize.post"),
  postId: z.string(),
  operation: z.object({
    operationId: z.string(),
    state: z.enum(["processing", "completed", "failed", "cancelled"]),
    pollAfterMs: z.number().int().positive()
  }),
  achievementDelta: AchievementDeltaSchema.optional(),
  legendRewards: LegendRewardEnvelopeSchema.optional(),
  canonicalCreated: z.boolean(),
  mediaReadiness: PostMediaReadinessSchema.optional(),
  mediaStatus: z.enum(["processing", "ready", "failed"]).optional(),
  assetsReady: z.boolean().optional(),
  videoProcessingStatus: z.string().optional(),
  posterReady: z.boolean().optional(),
  posterPresent: z.boolean().optional(),
  posterUrl: z.string().url().optional(),
  playbackReady: z.boolean().optional(),
  playbackUrlPresent: z.boolean().optional(),
  playbackUrl: z.string().url().optional(),
  fallbackVideoUrl: z.string().url().optional(),
  instantPlaybackReady: z.boolean().optional(),
  hasVideo: z.boolean().optional(),
  aspectRatio: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  resizeMode: z.enum(["cover", "contain"]).optional(),
  gradientTop: z.string().nullable().optional(),
  gradientBottom: z.string().nullable().optional(),
  idempotency: z.object({
    replayed: z.boolean()
  }),
  invalidation: z.object({
    invalidatedKeysCount: z.number().int().nonnegative(),
    invalidationTypes: z.array(z.string())
  }),
  /** Canonical App Post envelope read back from Firestore after finalize (native should prefer over optimistic merge). */
  appPost: z.record(z.string(), z.unknown()).optional(),
  postContractVersion: z.number().int().optional()
});

export const postingFinalizeContract = defineContract({
  routeName: "posting.finalize.post",
  method: "POST",
  path: "/v2/posting/finalize",
  query: z.object({}).strict(),
  body: PostingFinalizeBodySchema,
  response: PostingFinalizeResponseSchema
});
