import { z } from "zod";

/**
 * Undiscovered Reels — geolocated + attributed Instagram reels for the map.
 *
 * Pipeline: collected reel (shortcode + caption + owner) → AI extracts the place
 * name from the caption → matched to an existing undiscovered spot (exact coords
 * + link) or independently geocoded → creator attribution captured → written to
 * the `undiscoveredReels` collection for Aaron's map to render + credit creators.
 */

export const REEL_LOCATION_SOURCES = ["spot_match", "geocode", "ai_estimate", "none"] as const;
export type ReelLocationSource = (typeof REEL_LOCATION_SOURCES)[number];

/** Everything needed to credit the creator in-app. */
export const ReelCreatorSchema = z.object({
  username: z.string().nullable(),
  fullName: z.string().nullable(),
  profilePicUrl: z.string().nullable(),
  profileUrl: z.string().nullable(),
});
export type ReelCreator = z.infer<typeof ReelCreatorSchema>;

export const ReelLocationSchema = z.object({
  /** Place name the AI pulled from the caption (e.g. "Warren Falls"). */
  extractedName: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  source: z.enum(REEL_LOCATION_SOURCES),
  /** When source === "spot_match": the unexploredSpots/Routes doc it links to. */
  matchedSpotId: z.string().nullable(),
  matchedSpotCollection: z.enum(["unexploredSpots", "unexploredRoutes"]).nullable(),
  /** 0–1 confidence in the location (AI + match strength). */
  confidence: z.number().min(0).max(1),
});
export type ReelLocation = z.infer<typeof ReelLocationSchema>;

export const UndiscoveredReelSchema = z.object({
  /** Deterministic id: `reel_<shortcode>` — idempotent re-runs. */
  id: z.string(),
  kind: z.literal("undiscovered_reel"),
  sourceCollection: z.literal("undiscoveredReels"),
  region: z.string(),
  shortcode: z.string(),
  reelUrl: z.string(),
  caption: z.string(),
  videoUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  creator: ReelCreatorSchema,
  location: ReelLocationSchema,
  /** Review status mirrors the spot workflow so reels can be curated the same way. */
  reviewStatus: z.enum(["candidate", "approved", "rejected", "published"]).default("candidate"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UndiscoveredReel = z.infer<typeof UndiscoveredReelSchema>;

/** One collected reel handed to the pipeline (from the extension / downloader). */
export const CollectedReelInputSchema = z.object({
  shortcode: z.string().min(1),
  caption: z.string().default(""),
  reelUrl: z.string().optional(),
  videoUrl: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  ownerUsername: z.string().nullable().optional(),
  ownerFullName: z.string().nullable().optional(),
  ownerProfilePicUrl: z.string().nullable().optional(),
  /** Raw IG owner/media object (if the export included one) — the authoritative creator source. */
  ownerRaw: z.record(z.unknown()).optional(),
  /**
   * When the reel's place is already known (e.g. fetched from that spot's own
   * hashtag), the pipeline uses this directly and skips AI extraction — faster
   * and more accurate than re-deriving the place from the caption.
   */
  knownPlaceName: z.string().optional(),
});
export type CollectedReelInput = z.infer<typeof CollectedReelInputSchema>;

export const GeolocateReelsBodySchema = z.object({
  region: z.string().default("VT"),
  reels: z.array(CollectedReelInputSchema).min(1).max(200),
  /** When false, compute records but don't write to Firestore (dry run). */
  write: z.boolean().default(false),
  /** Live-fetch the authoritative creator from Instagram when the reel lacks an owner object. */
  resolveCreators: z.boolean().default(true),
  /** Optional IG session cookie header — makes live creator resolution reliable from datacenter IPs. */
  instagramCookieHeader: z.string().optional(),
});

export const FetchBySpotsBodySchema = z.object({
  region: z.string().default("VT"),
  /** Spot names to fetch reels for. If omitted, the top-N spots by name are pulled from Firestore. */
  spotNames: z.array(z.string().min(2)).max(50).optional(),
  /** When spotNames omitted, how many spots to auto-pull. */
  topN: z.number().int().min(1).max(50).default(10),
  /** IG session cookie header — required for IG hashtag pages to return anything from a server. */
  instagramCookieHeader: z.string().optional(),
  write: z.boolean().default(false),
});
