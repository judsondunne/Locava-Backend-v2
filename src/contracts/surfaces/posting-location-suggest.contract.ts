import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingLocationSuggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(12).optional()
});

const PostingLocationSuggestRowSchema = z.object({
  text: z.string(),
  type: z.enum(["town", "state"]),
  suggestionType: z.literal("place"),
  data: z.object({
    locationText: z.string(),
    cityRegionId: z.string().optional(),
    stateRegionId: z.string(),
    stateName: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable()
  })
});

export const PostingLocationSuggestResponseSchema = z.object({
  routeName: z.literal("posting.location_suggest.get"),
  suggestions: z.array(PostingLocationSuggestRowSchema)
});

export const postingLocationSuggestContract = defineContract({
  routeName: "posting.location_suggest.get",
  method: "GET",
  path: "/v2/posting/location/suggest",
  query: PostingLocationSuggestQuerySchema,
  body: z.object({}).strict(),
  response: PostingLocationSuggestResponseSchema
});

