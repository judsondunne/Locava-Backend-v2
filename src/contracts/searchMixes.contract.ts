import { z } from "zod";
import { defineContract, EmptySchema } from "./conventions.js";

const LatLngSchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
});

export const SearchMixTypeSchema = z.enum([
  "nearby",
  "activity",
  "location_activity",
  "location_general",
  "daily",
  "friends",
  "trending",
  "suggested",
]);

export const SearchMixSchema = z.object({
  id: z.string().min(1),
  type: SearchMixTypeSchema,
  title: z.string().min(1),
  subtitle: z.string().optional(),
  coverPostIds: z.array(z.string()).default([]),
  coverMediaUrls: z.array(z.string()).default([]),
  primaryActivity: z.string().optional(),
  activityFilters: z.array(z.string()).optional(),
  locationLabel: z.string().optional(),
  center: LatLngSchema.optional(),
  radiusMiles: z.number().finite().positive().optional(),
  resultCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable().optional(),
  quality: z.object({
    hasCoverArt: z.boolean(),
    enoughPosts: z.boolean(),
    locationTruthScore: z.number().finite().min(0).max(1),
    activityTruthScore: z.number().finite().min(0).max(1),
  }),
  debug: z
    .object({
      generationSource: z.string(),
      radiusExpansionSteps: z.array(z.number().finite().positive()).optional(),
      scoringVersion: z.string(),
    })
    .optional(),
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

export const SearchMixesFeedResponseSchema = z.object({
  routeName: z.literal("search.mixes.feed.post"),
  mixId: z.string(),
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

