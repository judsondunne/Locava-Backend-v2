import { z } from "zod";
import { defineContract } from "../conventions.js";
import { ProfileEndpointDebugSchema } from "./profile-bootstrap.contract.js";

export const ProfileRelationshipParamsSchema = z.object({
  userId: z.string().min(6),
});

export const ProfileRelationshipResponseSchema = z.object({
  routeName: z.literal("profile.relationship.get"),
  profileUserId: z.string(),
  relationship: z.object({
    isSelf: z.boolean(),
    following: z.boolean(),
    followedBy: z.boolean(),
    canMessage: z.boolean(),
  }),
  counts: z.object({
    posts: z.number().int().nonnegative(),
    followers: z.number().int().nonnegative(),
    following: z.number().int().nonnegative(),
  }),
  debug: ProfileEndpointDebugSchema.optional(),
});

export const profileRelationshipContract = defineContract({
  routeName: "profile.relationship.get",
  method: "GET",
  path: "/v2/profiles/:userId/relationship",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: ProfileRelationshipResponseSchema,
});

export type ProfileRelationshipResponse = z.infer<typeof ProfileRelationshipResponseSchema>;
