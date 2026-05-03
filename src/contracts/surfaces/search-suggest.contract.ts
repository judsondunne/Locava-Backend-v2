import { z } from "zod";
import { defineContract } from "../conventions.js";

export const SearchSuggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional()
});

const SuggestionRowSchema = z.object({
  text: z.string(),
  type: z.string(),
  suggestionType: z.string().optional(),
  badge: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional()
});

export const SearchSuggestResponseSchema = z.object({
  routeName: z.literal("search.suggest.get"),
  suggestions: z.array(SuggestionRowSchema),
  detectedActivity: z.string().nullable(),
  relatedActivities: z.array(z.string()),
  suggestDiagnostics: z.record(z.string(), z.unknown()).optional()
});

export const searchSuggestContract = defineContract({
  routeName: "search.suggest.get",
  method: "GET",
  path: "/v2/search/suggest",
  query: SearchSuggestQuerySchema,
  body: z.object({}).strict(),
  response: SearchSuggestResponseSchema
});

