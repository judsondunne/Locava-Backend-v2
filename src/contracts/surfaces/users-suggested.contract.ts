import { z } from "zod";
import { defineContract } from "../conventions.js";

export const UsersSuggestedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).optional(),
  surface: z.enum(["onboarding", "profile", "search", "home", "notifications", "generic"]).optional(),
  includeDebug: z.union([z.literal("0"), z.literal("1")]).optional()
});

export const UsersSuggestedResponseSchema = z.object({
  routeName: z.literal("users.suggested.get"),
  viewerId: z.string().min(1),
  surface: z.enum(["onboarding", "profile", "search", "home", "notifications", "generic"]),
  items: z.array(
    z.object({
      user: z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        handle: z.string().optional(),
        profilePic: z.string().optional()
      }),
      score: z.number().optional(),
      mutualCount: z.number().int().nonnegative(),
      mutualPreviewUserIds: z.array(z.string()).optional(),
      mutualPreview: z.array(z.object({ userId: z.string().min(1), handle: z.string().nullable().optional() })).optional(),
      reasons: z.array(z.object({ type: z.string().min(1), label: z.string().min(1).max(120) })).optional(),
      cursor: z.string().min(1)
    })
  ),
  nextCursor: z.string().nullable(),
  fromCache: z.boolean(),
  diagnostics: z
    .object({
      payloadBytes: z.number().int().nonnegative(),
      dbReads: z.number().int().nonnegative(),
      queryCount: z.number().int().nonnegative(),
      cache: z.object({
        hits: z.number().int().nonnegative(),
        misses: z.number().int().nonnegative()
      })
    })
    .optional()
});

export const usersSuggestedContract = defineContract({
  method: "GET",
  path: "/v2/users/suggested",
  routeName: "users.suggested.get",
  query: UsersSuggestedQuerySchema,
  body: z.object({}).strict(),
  response: UsersSuggestedResponseSchema
});

