import { z } from "zod";
import { defineContract } from "../conventions.js";

export const PostingSongsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(120).optional(),
  genre: z.string().trim().max(80).optional()
});

export const PostingSongSchema = z
  .object({
    id: z.string(),
    nameOfSong: z.string(),
    Author: z.string().optional(),
    authorName: z.string().optional(),
    displayPhoto: z.string().optional(),
    mediaLink: z.string().optional(),
    suggestedStartPoint: z.number().optional(),
    duration: z.number().optional(),
    genre: z.union([z.string(), z.array(z.string())]).optional()
  })
  .passthrough();

export const PostingSongsResponseSchema = z.object({
  routeName: z.literal("posting.songs.get"),
  audio: z.array(PostingSongSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive()
});

export const postingSongsContract = defineContract({
  routeName: "posting.songs.get",
  method: "GET",
  path: "/v2/posting/songs",
  query: PostingSongsQuerySchema,
  body: z.object({}).strict(),
  response: PostingSongsResponseSchema
});
