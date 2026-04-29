import { z } from "zod";
import { defineContract } from "../conventions.js";
import { PostCardSummarySchema } from "../entities/post-entities.contract.js";

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
      items: z.array(z.record(z.string(), z.unknown())),
      hasMore: z.boolean(),
      cursor: z.string().nullable()
    }),
    users: z.object({
      items: z.array(z.record(z.string(), z.unknown())),
      hasMore: z.boolean(),
      cursor: z.string().nullable()
    }),
    mixes: z.object({
      items: z.array(z.record(z.string(), z.unknown())),
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
