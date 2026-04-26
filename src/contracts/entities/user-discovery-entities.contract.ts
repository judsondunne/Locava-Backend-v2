import { z } from "zod";

/**
 * Canonical minimal user row for discovery / pickers / incremental search.
 * Intentionally small — not a full profile.
 */
export const UserDiscoveryRowSchema = z.object({
  userId: z.string(),
  handle: z.string(),
  displayName: z.string().nullable(),
  profilePic: z.string().nullable(),
  bioSnippet: z.string().max(200).nullable().optional(),
  isFollowing: z.boolean().optional(),
  isSuggested: z.boolean().optional(),
  relevanceReason: z.string().max(120).nullable().optional(),
  mutualCount: z.number().int().nonnegative().optional()
});

export type UserDiscoveryRow = z.infer<typeof UserDiscoveryRowSchema>;
