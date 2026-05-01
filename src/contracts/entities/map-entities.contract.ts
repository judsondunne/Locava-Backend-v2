import { z } from "zod";

export const MapMarkerSummarySchema = z.object({
  markerId: z.string(),
  postId: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  thumbUrl: z.string().url().nullable(),
  mediaType: z.enum(["image", "video"]),
  ts: z.number().int().nonnegative(),
  activityIds: z.array(z.string()),
  settingType: z.enum(["indoor", "outdoor"]).nullable(),
  openPayload: z.record(z.unknown()).nullable().optional(),
}).passthrough();

export type MapMarkerSummary = z.infer<typeof MapMarkerSummarySchema>;
