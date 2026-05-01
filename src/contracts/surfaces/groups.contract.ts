import { z } from "zod";
import { defineContract } from "../conventions.js";

export const GroupMembershipSummarySchema = z.object({
  groupId: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  photoUrl: z.string(),
  role: z.enum(["owner", "member"]),
  joinedAt: z.number().int().nonnegative(),
});

export const GroupCollegeSchema = z.object({
  enabled: z.boolean(),
  eduEmailDomain: z.string(),
  requiresVerification: z.boolean(),
});

export const GroupDirectoryRowSchema = z.object({
  groupId: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  bio: z.string(),
  photoUrl: z.string(),
  memberCount: z.number().int().nonnegative(),
  chatId: z.string().nullable(),
  joinMode: z.enum(["open", "private"]),
  isPublic: z.boolean(),
  college: GroupCollegeSchema,
  viewerMembership: z.object({
    isMember: z.boolean(),
    role: z.enum(["owner", "member"]).optional(),
  }),
});

export const GroupMemberRowSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  handle: z.string(),
  profilePic: z.string(),
  role: z.enum(["owner", "member"]),
  joinedAt: z.number().int().nonnegative().nullable().optional(),
  xp: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  tier: z.string(),
  postsCount: z.number().int().nonnegative(),
});

export const GroupDetailSchema = z.object({
  groupId: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  bio: z.string(),
  photoUrl: z.string(),
  memberCount: z.number().int().nonnegative(),
  chatId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.number().int().nullable(),
  joinMode: z.enum(["open", "private"]),
  isPublic: z.boolean(),
  college: GroupCollegeSchema.extend({
    viewerVerified: z.boolean(),
    viewerVerifiedEmail: z.string().optional(),
  }),
  viewerMembership: z.object({
    isMember: z.boolean(),
    role: z.enum(["owner", "member"]).optional(),
    joinedAt: z.number().int().nonnegative().optional(),
  }),
  membersPreview: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      handle: z.string(),
      profilePic: z.string(),
      role: z.enum(["owner", "member"]),
    }),
  ),
  members: z.array(GroupMemberRowSchema),
  analytics: z.object({
    postsCount: z.number().int().nonnegative(),
    activeMembers7d: z.number().int().nonnegative(),
    mappedPostsCount: z.number().int().nonnegative(),
    totalLikes: z.number().int().nonnegative(),
    totalComments: z.number().int().nonnegative(),
    placesCount: z.number().int().nonnegative(),
    topActivities: z.array(z.string()),
    latestPostAt: z.number().int().nullable(),
  }),
  achievements: z.object({
    totalXp: z.number().int().nonnegative(),
    averageXp: z.number().int().nonnegative(),
    combinedTier: z.string(),
    currentLeague: z.null(),
    nextLeague: z.null(),
    progress01: z.number(),
    globalRank: z.number().int().nullable(),
    totalGroups: z.number().int().nonnegative(),
    leaderboard: z.array(z.record(z.unknown())),
    leagueLeaderboard: z.array(z.record(z.unknown())),
    postsLeaderboard: z.array(z.record(z.unknown())),
    streakLeaderboard: z.array(z.record(z.unknown())),
    currentWeekStreak: z.number().int().nonnegative(),
    topContributors: z.array(GroupMemberRowSchema),
  }),
  competitions: z.object({
    seasonLabel: z.string(),
    highlightMetric: z.enum(["xp", "posts"]),
    customPrompt: z.string(),
    byScope: z.record(z.array(z.record(z.unknown()))),
    pinnedRivals: z.array(z.record(z.unknown())),
    availableScopes: z.array(z.string()),
    availableTemplates: z.array(z.string()),
  }),
  posts: z.array(z.record(z.unknown())),
  mapPoints: z.array(z.record(z.unknown())),
});

export const GroupsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(30),
  q: z.string().trim().max(80).optional(),
});

export const GroupsCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  bio: z.string().trim().max(500).optional(),
  photoUrl: z.string().url().nullable().optional(),
  college: z.object({
    enabled: z.boolean(),
    eduEmailDomain: z.string().trim().min(1),
  }).nullable().optional(),
});

export const GroupsUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  bio: z.string().trim().max(500).optional(),
  photoUrl: z.string().url().nullable().optional(),
  joinMode: z.enum(["open", "private"]).optional(),
  isPublic: z.boolean().optional(),
  college: z.object({
    enabled: z.boolean(),
    eduEmailDomain: z.string().trim(),
  }).nullable().optional(),
});

export const GroupsVerifyCollegeBodySchema = z.object({
  email: z.string().trim().email(),
  method: z.enum(["email_entry", "google"]).optional(),
});

export const GroupsInviteMembersBodySchema = z.object({
  memberIds: z.array(z.string().trim().min(1)).max(50),
});

export const GroupsAddMemberBodySchema = z.object({
  memberId: z.string().trim().min(1),
});

export const groupsListContract = defineContract({
  routeName: "groups.list.get",
  method: "GET",
  path: "/v2/groups",
  query: GroupsListQuerySchema,
  body: z.object({}).strict(),
  response: z.object({
    routeName: z.literal("groups.list.get"),
    groups: z.array(GroupDirectoryRowSchema),
  }),
});

export const groupsDetailContract = defineContract({
  routeName: "groups.detail.get",
  method: "GET",
  path: "/v2/groups/:groupId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: z.object({
    routeName: z.literal("groups.detail.get"),
    group: GroupDetailSchema,
  }),
});

export const groupsCreateContract = defineContract({
  routeName: "groups.create.post",
  method: "POST",
  path: "/v2/groups",
  query: z.object({}).strict(),
  body: GroupsCreateBodySchema,
  response: z.object({
    routeName: z.literal("groups.create.post"),
    success: z.literal(true),
    groupId: z.string().min(1),
    chatId: z.string().nullable(),
  }),
});

export const groupsUpdateContract = defineContract({
  routeName: "groups.update.patch",
  method: "PATCH",
  path: "/v2/groups/:groupId",
  query: z.object({}).strict(),
  body: GroupsUpdateBodySchema,
  response: z.object({
    routeName: z.literal("groups.update.patch"),
    success: z.literal(true),
    groupId: z.string().min(1),
  }),
});

export const groupsJoinContract = defineContract({
  routeName: "groups.join.post",
  method: "POST",
  path: "/v2/groups/:groupId/join",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: z.object({
    routeName: z.literal("groups.join.post"),
    success: z.literal(true),
    group: GroupMembershipSummarySchema,
    chatId: z.string().nullable(),
    alreadyJoined: z.boolean(),
  }),
});

export const groupsVerifyCollegeContract = defineContract({
  routeName: "groups.verify_college.post",
  method: "POST",
  path: "/v2/groups/:groupId/verify-college",
  query: z.object({}).strict(),
  body: GroupsVerifyCollegeBodySchema,
  response: z.object({
    routeName: z.literal("groups.verify_college.post"),
    success: z.literal(true),
    group: GroupMembershipSummarySchema,
    chatId: z.string().nullable(),
    alreadyJoined: z.boolean(),
    verifiedEmail: z.string().email(),
  }),
});

export const groupsAddMemberContract = defineContract({
  routeName: "groups.add_member.post",
  method: "POST",
  path: "/v2/groups/:groupId/members",
  query: z.object({}).strict(),
  body: GroupsAddMemberBodySchema,
  response: z.object({
    routeName: z.literal("groups.add_member.post"),
    success: z.literal(true),
    groupId: z.string().min(1),
  }),
});

export const groupsInviteMembersContract = defineContract({
  routeName: "groups.invite_members.post",
  method: "POST",
  path: "/v2/groups/:groupId/invitations",
  query: z.object({}).strict(),
  body: GroupsInviteMembersBodySchema,
  response: z.object({
    routeName: z.literal("groups.invite_members.post"),
    success: z.literal(true),
    invitedUserIds: z.array(z.string()),
    skippedUserIds: z.array(z.string()),
  }),
});

export const groupsRemoveMemberContract = defineContract({
  routeName: "groups.remove_member.delete",
  method: "DELETE",
  path: "/v2/groups/:groupId/members/:memberId",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: z.object({
    routeName: z.literal("groups.remove_member.delete"),
    success: z.literal(true),
    groupId: z.string().min(1),
  }),
});

export const groupsShareLinkContract = defineContract({
  routeName: "groups.share_link.get",
  method: "GET",
  path: "/v2/groups/:groupId/share-link",
  query: z.object({}).strict(),
  body: z.object({}).strict(),
  response: z.object({
    routeName: z.literal("groups.share_link.get"),
    success: z.literal(true),
    url: z.string().url(),
  }),
});
