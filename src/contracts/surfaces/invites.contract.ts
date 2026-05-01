import { z } from "zod";
import { defineContract } from "../conventions.js";

export const InviteResolveBodySchema = z.object({
  branchData: z.record(z.unknown()),
});

const InviteResolvedInviterSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  handle: z.string(),
  profilePic: z.string().nullable(),
  resolvedUserExists: z.boolean(),
});

const InviteResolvedGroupSchema = z.object({
  groupId: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  bio: z.string(),
  photoUrl: z.string(),
  memberCount: z.number().int().nonnegative(),
  chatId: z.string().nullable(),
  joinMode: z.enum(["open", "private"]),
  isPublic: z.boolean(),
  college: z.object({
    enabled: z.boolean(),
    eduEmailDomain: z.string(),
    requiresVerification: z.boolean(),
  }),
});

export const invitesResolveContract = defineContract({
  routeName: "invites.resolve.post",
  method: "POST",
  path: "/v2/invites/resolve",
  query: z.object({}).strict(),
  body: InviteResolveBodySchema,
  response: z.object({
    routeName: z.literal("invites.resolve.post"),
    inviteType: z.enum(["user_invite", "group_invite"]),
    inviteToken: z.string().nullable(),
    inviter: InviteResolvedInviterSchema.nullable(),
    group: InviteResolvedGroupSchema.nullable(),
  }),
});
