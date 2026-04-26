import { z } from "zod";
import { defineContract } from "../conventions.js";

const SearchBootstrapPostRowSchema = z.object({
  postId: z.string(),
  id: z.string(),
  userId: z.string(),
  thumbUrl: z.string(),
  displayPhotoLink: z.string(),
  title: z.string(),
  activities: z.array(z.string())
});

export const SearchBootstrapQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(80).default(24),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional()
});

export const SearchBootstrapResponseSchema = z.object({
  routeName: z.literal("search.bootstrap.get"),
  posts: z.array(SearchBootstrapPostRowSchema),
  rails: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      posts: z.array(SearchBootstrapPostRowSchema)
    })
  ),
  suggestedUsers: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      name: z.string(),
      handle: z.string(),
      profilePic: z.string()
    })
  ),
  popularActivities: z.array(z.string()),
  parsedSummary: z.object({
    activity: z.string().nullable(),
    nearMe: z.boolean(),
    genericDiscovery: z.boolean()
  })
});

export const searchBootstrapContract = defineContract({
  routeName: "search.bootstrap.get",
  method: "GET",
  path: "/v2/search/bootstrap",
  query: SearchBootstrapQuerySchema,
  body: z.object({}).strict(),
  response: SearchBootstrapResponseSchema
});

