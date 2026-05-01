import { z } from "zod";
import { defineContract } from "../conventions.js";
import { ProfileEndpointDebugSchema, ProfileGridPreviewItemSchema } from "./profile-bootstrap.contract.js";

export const ProfileGridParamsSchema = z.object({
  userId: z.string().min(6)
});

export const ProfileGridQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(6).max(24).default(12)
});

export const ProfileGridResponseSchema = z.object({
  routeName: z.literal("profile.grid.get"),
  profileUserId: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("updatedAtMs_desc")
  }),
  items: z.array(ProfileGridPreviewItemSchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string()),
  debug: ProfileEndpointDebugSchema.optional(),
});

export const profileGridContract = defineContract({
  routeName: "profile.grid.get",
  method: "GET",
  path: "/v2/profiles/:userId/grid",
  query: ProfileGridQuerySchema,
  body: z.object({}).strict(),
  response: ProfileGridResponseSchema
});

export type ProfileGridResponse = z.infer<typeof ProfileGridResponseSchema>;
