import { z } from "zod";
import { defineContract, EmptySchema } from "../conventions.js";

export const UNDISCOVERED_PHOTO_SEARCH_DISCLAIMER =
  "These are web image search results from the linked sources. Locava does not own, upload, or claim these images.";

export const UNDISCOVERED_PHOTO_RESULT_DISCLAIMER =
  "Image/result is from the web source shown. Locava does not own or claim this image.";

export const UndiscoveredPhotoSearchCollectionSchema = z.enum(["unexploredSpots", "unexploredRoutes"]);

export const UndiscoveredPhotoSearchResultItemSchema = z.object({
  id: z.string(),
  rank: z.number().int().positive(),
  thumbnailUrl: z.string().url(),
  imageUrl: z.string().url().nullable(),
  sourceUrl: z.string().url(),
  sourceTitle: z.string(),
  sourceDomain: z.string(),
  provider: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  attributionText: z.string(),
  license: z.string().nullable(),
  copyrightNotice: z.string().nullable(),
  disclaimer: z.string(),
  confidence: z.number().nullable(),
  validationStatus: z.enum(["accepted", "unvalidated"]),
  fetchedAt: z.string(),
});

export const UndiscoveredPhotoSearchCacheSchema = z.object({
  schema: z.literal("locava.undiscoveredPhotoSearch"),
  version: z.literal(1),
  status: z.enum(["ready", "empty", "failed", "refreshing"]),
  query: z.string(),
  provider: z.enum(["serper", "bing", "mock", "none"]),
  validator: z.literal("none"),
  fetchedAt: z.string(),
  expiresAt: z.string(),
  resultCount: z.number().int().min(0),
  results: z.array(UndiscoveredPhotoSearchResultItemSchema),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
});

export const UndiscoveredPhotoSearchBodySchema = z
  .object({
    collection: UndiscoveredPhotoSearchCollectionSchema,
    id: z.string().trim().min(1).max(256),
    forceRefresh: z.boolean().optional(),
    name: z.string().trim().max(200).optional(),
    town: z.string().trim().max(120).optional(),
    state: z.string().trim().max(80).optional(),
    lat: z.number().finite().optional(),
    long: z.number().finite().optional(),
    osmTags: z.record(z.string()).optional(),
    type: z.string().trim().max(80).optional(),
  })
  .strict();

export const UndiscoveredPhotoSearchResponseSchema = z.object({
  routeName: z.literal("undiscovered.photo_search.post"),
  schema: z.literal("locava.undiscoveredPhotoSearch"),
  version: z.literal(1),
  cached: z.boolean(),
  cacheStatus: z.enum(["hit", "miss", "refreshed", "empty", "failed"]),
  undiscovered: z.object({
    collection: UndiscoveredPhotoSearchCollectionSchema,
    id: z.string(),
    title: z.string(),
    town: z.string().nullable(),
    state: z.string().nullable(),
  }),
  query: z.string(),
  items: z.array(UndiscoveredPhotoSearchResultItemSchema),
  disclaimer: z.string(),
});

export const undiscoveredPhotoSearchContract = defineContract({
  routeName: "undiscovered.photo_search.post",
  method: "POST",
  path: "/v2/undiscovered/photo-search",
  query: EmptySchema,
  body: UndiscoveredPhotoSearchBodySchema,
  response: UndiscoveredPhotoSearchResponseSchema,
});

export type UndiscoveredPhotoSearchBody = z.infer<typeof UndiscoveredPhotoSearchBodySchema>;
export type UndiscoveredPhotoSearchCache = z.infer<typeof UndiscoveredPhotoSearchCacheSchema>;
export type UndiscoveredPhotoSearchResultItem = z.infer<typeof UndiscoveredPhotoSearchResultItemSchema>;
export type UndiscoveredPhotoSearchResponse = z.infer<typeof UndiscoveredPhotoSearchResponseSchema>;
