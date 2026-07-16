import { z } from "zod";
import { defineContract } from "../conventions.js";

/**
 * Undiscovered Reels map layer — bbox query returning geolocated reels for the
 * native map: each feature carries the poster thumbnail, the playable video URL
 * (null until media ingest runs), creator attribution, and the spot it links to.
 */

export const ReelMapFeatureSchema = z.object({
  id: z.string(),
  shortcode: z.string(),
  lat: z.number(),
  lng: z.number(),
  matchedSpotId: z.string().nullable(),
  matchedSpotCollection: z.enum(["unexploredSpots", "unexploredRoutes"]).nullable(),
  reelUrl: z.string(),
  /** Hosted, playable media. `playable` is false until ingest fills videoUrl. */
  videoUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  playable: z.boolean(),
  creator: z.object({
    username: z.string().nullable(),
    fullName: z.string().nullable(),
    profilePicUrl: z.string().nullable(),
    profileUrl: z.string().nullable(),
  }),
  qualityScore: z.number(),
});
export type ReelMapFeature = z.infer<typeof ReelMapFeatureSchema>;

export const UndiscoveredReelsMapResponseSchema = z.object({
  features: z.array(ReelMapFeatureSchema),
  count: z.number().int().nonnegative(),
  /** True when more reels matched the bbox than the limit returned. */
  truncated: z.boolean(),
  generatedAt: z.number().int().nonnegative(),
});
export type UndiscoveredReelsMapResponse = z.infer<typeof UndiscoveredReelsMapResponseSchema>;

export const undiscoveredReelsMapContract = defineContract({
  routeName: "map.layers.undiscovered_reels.get",
  method: "GET",
  path: "/v2/map/layers/undiscovered-reels",
  query: z.object({
    bbox: z.string().min(1),
    zoom: z.coerce.number().int().min(1).max(20).optional(),
    /** Max features to return (highest quality first). */
    limit: z.coerce.number().int().min(1).max(500).default(200),
    /** When true, only reels whose media has been ingested (playable). */
    playableOnly: z.coerce.boolean().default(false),
  }),
  body: z.object({}).strict(),
  response: UndiscoveredReelsMapResponseSchema,
});
