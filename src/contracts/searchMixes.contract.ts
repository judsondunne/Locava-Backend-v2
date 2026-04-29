import { z } from "zod";
import { defineContract, EmptySchema } from "./conventions.js";

const MixTypeSchema = z.enum(["general", "daily", "nearby", "friends", "dynamic"]);

const MixIntentSchema = z.object({
  seedKind: z.enum(["activity_query", "friends", "daily"]),
  seedQuery: z.string().nullable(),
  activityFilters: z.array(z.string()),
  locationLabel: z.string().nullable(),
  locationConstraint: z
    .object({
      stateRegionId: z.string().optional(),
      cityRegionId: z.string().optional(),
      center: z.object({ lat: z.number().finite(), lng: z.number().finite() }).optional(),
      maxDistanceMiles: z.number().finite().positive().optional(),
    })
    .nullable(),
});

export const SearchMixSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  type: MixTypeSchema,
  intent: MixIntentSchema,
  coverImageUrl: z.string().nullable(),
  coverPostId: z.string().nullable(),
  previewPostIds: z.array(z.string()).default([]),
  candidateCount: z.number().int().nonnegative().optional(),
  requiresLocation: z.boolean().optional(),
  requiresFollowing: z.boolean().optional(),
  hiddenReason: z.string().nullable().optional(),
  debugMix: z.record(z.string(), z.unknown()).optional(),
});

export const SearchMixesBootstrapQuerySchema = z.object({
  lat: z.coerce.number().finite().optional(),
  lng: z.coerce.number().finite().optional(),
  limit: z.coerce.number().int().min(1).max(24).default(8),
  includeDebug: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "1"),
});

export const SearchMixesBootstrapResponseSchema = z.object({
  routeName: z.literal("search.mixes.bootstrap.get"),
  mixes: z.array(SearchMixSchema),
  scoringVersion: z.string(),
});

export const searchMixesBootstrapContract = defineContract({
  routeName: "search.mixes.bootstrap.get",
  method: "GET",
  path: "/v2/search/mixes/bootstrap",
  query: SearchMixesBootstrapQuerySchema,
  body: EmptySchema,
  response: SearchMixesBootstrapResponseSchema,
});

export const SearchMixesFeedBodySchema = z.object({
  mixId: z.string().min(1),
  cursor: z.string().nullable().optional(),
  limit: z.coerce.number().int().min(4).max(36).default(20),
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
  includeDebug: z.boolean().optional(),
});

export const SearchMixesFeedQuerySchema = z.object({
  mixId: z.string().min(1),
  cursor: z.string().nullable().optional(),
  limit: z.coerce.number().int().min(4).max(36).default(20),
  lat: z.coerce.number().finite().nullable().optional(),
  lng: z.coerce.number().finite().nullable().optional(),
  includeDebug: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "1"),
});

export const SearchMixesFeedResponseSchema = z.object({
  routeName: z.literal("search.mixes.feed.post"),
  mixId: z.string(),
  mix: SearchMixSchema.optional(),
  posts: z.array(z.record(z.string(), z.unknown())),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  scoringVersion: z.string(),
  debug: z.record(z.string(), z.unknown()).optional(),
});

export const searchMixesFeedContract = defineContract({
  routeName: "search.mixes.feed.post",
  method: "POST",
  path: "/v2/search/mixes/feed",
  query: EmptySchema,
  body: SearchMixesFeedBodySchema,
  response: SearchMixesFeedResponseSchema,
});

export const searchMixesFeedGetContract = defineContract({
  routeName: "search.mixes.feed.post",
  method: "GET",
  path: "/v2/search/mixes/feed",
  query: SearchMixesFeedQuerySchema,
  body: EmptySchema,
  response: SearchMixesFeedResponseSchema,
});

