import { z } from "zod";
import { defineContract } from "../conventions.js";
import {
  ProfileCollectionPreviewItemSchema,
  ProfileEndpointDebugSchema,
} from "./profile-bootstrap.contract.js";

export const ProfileCollectionsParamsSchema = z.object({
  userId: z.string().min(6),
});

export const ProfileCollectionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(3).max(24).default(6),
});

export const ProfileCollectionsResponseSchema = z.object({
  routeName: z.literal("profile.collections.get"),
  profileUserId: z.string(),
  page: z.object({
    cursorIn: z.string().nullable(),
    limit: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
    sort: z.literal("updatedAtMs_desc"),
  }),
  items: z.array(ProfileCollectionPreviewItemSchema),
  degraded: z.boolean(),
  fallbacks: z.array(z.string()),
  debug: ProfileEndpointDebugSchema.optional(),
});

export const profileCollectionsContract = defineContract({
  routeName: "profile.collections.get",
  method: "GET",
  path: "/v2/profiles/:userId/collections",
  query: ProfileCollectionsQuerySchema,
  body: z.object({}).strict(),
  response: ProfileCollectionsResponseSchema,
});

export type ProfileCollectionsResponse = z.infer<typeof ProfileCollectionsResponseSchema>;
