import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

export const FeedBootstrapQuerySchema = z.object({
  limit: z.coerce.number().int().min(4).max(8).default(5),
  tab: z.enum(["explore", "following"]).default("explore"),
  radiusLabel: z.string().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().optional(),
  debugSlowDeferredMs: z.coerce.number().int().min(0).max(2000).default(0)
});

export const FeedBootstrapItemSchema = PostCardSummarySchema;

export const FeedBootstrapResponseSchema = z.object({
  routeName: z.literal("feed.bootstrap.get"),
  firstRender: z.object({
    viewer: z.object({
      viewerId: z.string(),
      authenticated: z.boolean()
    }),
    feed: z.object({
      page: z.object({
        limit: z.number().int().positive(),
        count: z.number().int().nonnegative(),
        nextCursor: z.string().nullable(),
        sort: z.literal("ranked_session")
      }),
      items: z.array(FeedBootstrapItemSchema)
    })
  }),
  deferred: z.object({
    sessionHints: z.object({
      recommendationPath: z.enum(["for_you_light"]),
      staleAfterMs: z.number().int().positive()
    }).nullable()
  }),
  background: z.object({
    cacheWarmScheduled: z.boolean(),
    prefetchHints: z.array(z.string())
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string()),
  debugFeedSource: z.literal("backendv2_firestore").optional(),
  debugCandidateCount: z.number().int().nonnegative().optional(),
  debugCandidateReads: z.number().int().nonnegative().optional(),
  debugReturnedCount: z.number().int().nonnegative().optional(),
  debugFailureReason: z.string().optional(),
  debugFilterDropReasons: z.record(z.number().int().nonnegative()).optional()
});

export const feedBootstrapContract = defineContract({
  routeName: "feed.bootstrap.get",
  method: "GET",
  path: "/v2/feed/bootstrap",
  query: FeedBootstrapQuerySchema,
  body: z.object({}).strict(),
  response: FeedBootstrapResponseSchema
});

export type FeedBootstrapResponse = z.infer<typeof FeedBootstrapResponseSchema>;
