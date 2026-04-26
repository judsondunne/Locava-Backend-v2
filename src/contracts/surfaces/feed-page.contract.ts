import { z } from "zod";
import { defineContract } from "../conventions.js";
import { FeedBootstrapItemSchema } from "./feed-bootstrap.contract.js";

export const FeedPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(4).max(8).default(5),
  tab: z.enum(["explore", "following"]).default("explore"),
  radiusLabel: z.string().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().optional()
});

export const FeedPageResponseSchema = z.object({
  routeName: z.literal("feed.page.get"),
  requestKey: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("ranked_session")
  }),
  items: z.array(FeedBootstrapItemSchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string()),
  debugFeedSource: z.literal("backendv2_firestore").optional(),
  debugCandidateCount: z.number().int().nonnegative().optional(),
  debugCandidateReads: z.number().int().nonnegative().optional(),
  debugReturnedCount: z.number().int().nonnegative().optional(),
  debugFailureReason: z.string().optional(),
  debugFilterDropReasons: z.record(z.number().int().nonnegative()).optional()
});

export const feedPageContract = defineContract({
  routeName: "feed.page.get",
  method: "GET",
  path: "/v2/feed/page",
  query: FeedPageQuerySchema,
  body: z.object({}).strict(),
  response: FeedPageResponseSchema
});

export type FeedPageResponse = z.infer<typeof FeedPageResponseSchema>;
