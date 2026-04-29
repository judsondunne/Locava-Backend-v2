import { z } from "zod";
import { defineContract } from "../conventions.js";

export const SocialContactInputSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  phoneNumbers: z.array(z.string().trim().min(1)).max(20).optional(),
  emails: z.array(z.string().trim().min(1)).max(20).optional()
});

export const SocialContactsSyncBodySchema = z.object({
  contacts: z.array(SocialContactInputSchema).max(5000)
});

export const SocialContactsSyncResponseSchema = z.object({
  routeName: z.literal("social.contacts_sync.post"),
  matchedUsers: z.array(
    z.object({
      userId: z.string().min(1),
      handle: z.string().nullable(),
      name: z.string().nullable(),
      profilePic: z.string().nullable(),
      reason: z.enum(["contacts", "referral", "groups", "mutuals", "popular", "nearby", "all_users"]),
      reasonLabel: z.string().max(120).nullable().optional(),
      mutualCount: z.number().int().nonnegative().optional(),
      mutualPreview: z.array(z.object({ userId: z.string().min(1), handle: z.string().nullable().optional() })).optional(),
      isFollowing: z.boolean(),
      followerCount: z.number().int().nonnegative().optional(),
      score: z.number().optional()
    })
  ),
  matchedCount: z.number().int().nonnegative(),
  syncedAt: z.number().int().positive()
});

// invalidation: contacts sync invalidates viewer suggested-friends/contact-match caches.
export const socialContactsSyncContract = defineContract({
  method: "POST",
  path: "/v2/social/contacts/sync",
  routeName: "social.contacts_sync.post",
  query: z.object({}).strict(),
  body: SocialContactsSyncBodySchema,
  response: SocialContactsSyncResponseSchema
});
