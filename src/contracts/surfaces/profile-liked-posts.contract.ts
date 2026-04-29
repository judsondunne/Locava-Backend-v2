import { z } from "zod";
import { defineContract } from "../conventions.js";

export const ProfileLikedPostsQuerySchema = z.object({
  cursor: z.string().nullable().optional(),
  limit: z.coerce.number().int().min(1).max(48).optional()
});

export const ProfileLikedPostsResponseSchema = z.object({
  routeName: z.literal("profile.liked_posts.get"),
  success: z.literal(true),
  posts: z.array(z.record(z.unknown())),
  nextCursor: z.string().nullable(),
  totalCount: z.number().int().nonnegative(),
  serverTsMs: z.number().int().nonnegative()
});

export const profileLikedPostsContract = defineContract({
  routeName: "profile.liked_posts.get",
  method: "GET",
  path: "/v2/profile/me/liked-posts",
  query: ProfileLikedPostsQuerySchema,
  body: z.object({}).strict(),
  response: ProfileLikedPostsResponseSchema
});

