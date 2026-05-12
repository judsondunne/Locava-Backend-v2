import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";
import { UserDiscoveryRowSchema } from "../entities/user-discovery-entities.contract.js";

export const SearchResultsQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(4).max(12).default(8),
  lat: z.coerce.number().finite().optional(),
  lng: z.coerce.number().finite().optional(),
  types: z.string().trim().optional(),
  debug: z
    .union([z.literal("1"), z.literal("0")])
    .optional()
    .transform((v) => v === "1"),
});

const SearchResultsCollectionSummarySchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  coverUri: z.string().url().nullable().optional(),
  postCount: z.number().int().nonnegative().optional()
});

const SearchResultsMixSummarySchema = z.object({
  id: z.string(),
  mixKey: z.string(),
  type: z.enum(["activity", "nearby"]),
  title: z.string(),
  subtitle: z.string().optional(),
  heroQuery: z.string().optional(),
  coverUri: z.string().url().nullable().optional(),
  activity: z.string().optional(),
  state: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  radiusKm: z.number().nullable().optional()
});

export const SearchResultsResponseSchema = z.object({
  routeName: z.literal("search.results.get"),
  requestKey: z.string(),
  queryEcho: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("search_ranked_v1")
  }),
  items: z.array(PostCardSummarySchema),
  debugSearch: z.record(z.string(), z.unknown()).optional(),
  sections: z.object({
    posts: z.object({
      items: z.array(PostCardSummarySchema),
      hasMore: z.boolean(),
      cursor: z.string().nullable()
    }),
    collections: z.object({
      items: z.array(SearchResultsCollectionSummarySchema),
      hasMore: z.boolean(),
      cursor: z.string().nullable()
    }),
    users: z.object({
      items: z.array(UserDiscoveryRowSchema),
      hasMore: z.boolean(),
      cursor: z.string().nullable()
    }),
    mixes: z.object({
      items: z.array(SearchResultsMixSummarySchema),
      hasMore: z.boolean(),
      cursor: z.string().nullable()
    })
  }),
  degraded: z.boolean(),
  fallbacks: z.array(z.string())
});

export const searchResultsContract = defineContract({
  routeName: "search.results.get",
  method: "GET",
  path: "/v2/search/results",
  query: SearchResultsQuerySchema,
  body: z.object({}).strict(),
  response: SearchResultsResponseSchema
});

export type SearchResultsResponse = z.infer<typeof SearchResultsResponseSchema>;
