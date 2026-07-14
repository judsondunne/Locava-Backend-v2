import { z } from "zod";
import { defineContract } from "../conventions.js";

/**
 * Reel templates surface: published reels are the template library. This endpoint lists
 * recent public reel posts (those carrying an `editProject`) so the client can slotify
 * each project into a reusable template ("save-template-on-publish" without a separate
 * collection — every published reel is instantly reusable).
 */

export const ReelTemplateItemSchema = z.object({
  /** Source post id (used as the template id on the client). */
  postId: z.string(),
  /** Display name for the template (post caption, else author fallback). */
  name: z.string(),
  /** Poster/thumbnail for the template card + preview. */
  posterUrl: z.string(),
  /** First playable video for the inspiration preview feed; omitted for photo-only reels. */
  previewVideoUrl: z.string().optional(),
  authorName: z.string().optional(),
  authorHandle: z.string().optional(),
  createdAtMs: z.number().optional(),
  /** The serialized timeline editor project the client slotifies into a template. */
  editProject: z.record(z.string(), z.unknown())
});

export const ReelTemplatesListResponseSchema = z.object({
  routeName: z.literal("reel.templates.list.get"),
  templates: z.array(ReelTemplateItemSchema)
});

export const ReelTemplatesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).optional()
});

export const reelTemplatesListContract = defineContract({
  routeName: "reel.templates.list.get",
  method: "GET",
  path: "/v2/reel-templates",
  query: ReelTemplatesListQuerySchema,
  body: z.object({}).strict(),
  response: ReelTemplatesListResponseSchema
});

/** Upper bound of reel docs scanned per request (ordered by createdAtMs desc). */
export const REEL_TEMPLATES_SCAN_LIMIT = 120;
/** Default number of templates returned. */
export const REEL_TEMPLATES_DEFAULT_LIMIT = 30;
