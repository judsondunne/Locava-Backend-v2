import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { LegacyGroupsFirestoreAdapter } from "../source-of-truth/legacy-groups-firestore.adapter.js";

export type GroupMembershipSummary = {
  groupId: string;
  name: string;
  slug: string;
  photoUrl: string;
  role: "owner" | "member";
  joinedAt: number;
};

export type GroupDirectoryRow = {
  groupId: string;
  name: string;
  slug: string;
  bio: string;
  photoUrl: string;
  memberCount: number;
  chatId: string | null;
  joinMode: "open" | "private";
  isPublic: boolean;
  college: {
    enabled: boolean;
    eduEmailDomain: string;
    requiresVerification: boolean;
  };
  viewerMembership: {
    isMember: boolean;
    role?: "owner" | "member";
  };
};

export type GroupMemberRow = {
  userId: string;
  name: string;
  handle: string;
  profilePic: string;
  role: "owner" | "member";
  joinedAt?: number | null;
  xp: number;
  level: number;
  tier: string;
  postsCount: number;
};

export type GroupDetailRecord = {
  groupId: string;
  name: string;
  slug: string;
  bio: string;
  photoUrl: string;
  memberCount: number;
  chatId: string | null;
  createdBy: string;
  createdAt: number | null;
  joinMode: "open" | "private";
  isPublic: boolean;
  college: {
    enabled: boolean;
    eduEmailDomain: string;
    requiresVerification: boolean;
    viewerVerified: boolean;
    viewerVerifiedEmail?: string;
  };
  viewerMembership: {
    isMember: boolean;
    role?: "owner" | "member";
    joinedAt?: number;
  };
  membersPreview: Array<{
    userId: string;
    name: string;
    handle: string;
    profilePic: string;
    role: "owner" | "member";
  }>;
  members: GroupMemberRow[];
  analytics: {
    postsCount: number;
    activeMembers7d: number;
    mappedPostsCount: number;
    totalLikes: number;
    totalComments: number;
    placesCount: number;
    topActivities: string[];
    latestPostAt: number | null;
  };
  achievements: {
    totalXp: number;
    averageXp: number;
    combinedTier: string;
    currentLeague: null;
    nextLeague: null;
    progress01: number;
    globalRank: number | null;
    totalGroups: number;
    leaderboard: GroupDirectoryRow[];
    leagueLeaderboard: GroupDirectoryRow[];
    postsLeaderboard: GroupDirectoryRow[];
    streakLeaderboard: GroupDirectoryRow[];
    currentWeekStreak: number;
    topContributors: GroupMemberRow[];
  };
  competitions: {
    seasonLabel: string;
    highlightMetric: "xp" | "posts";
    customPrompt: string;
    byScope: Record<string, Array<Record<string, unknown>>>;
    pinnedRivals: GroupDirectoryRow[];
    availableScopes: string[];
    availableTemplates: string[];
  };
  posts: Array<Record<string, unknown>>;
  mapPoints: Array<Record<string, unknown>>;
};

type UserSummary = {
  userId: string;
  name: string;
  handle: string;
  profilePic: string;
};

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function toFiniteInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function normalizeJoinMode(value: unknown): "open" | "private" {
  return value === "private" ? "private" : "open";
}

function deriveVisibility(data: Record<string, unknown>): { joinMode: "open" | "private"; isPublic: boolean } {
  const joinMode = normalizeJoinMode(data.joinMode);
  const raw = data.isPublic;
  const isPublic = typeof raw === "boolean" ? raw : joinMode === "open";
  return { joinMode: isPublic ? "open" : joinMode, isPublic };
}

function normalizeCollege(data: unknown): {
  enabled: boolean;
  eduEmailDomain: string;
  requiresVerification: boolean;
} {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const enabled = raw.enabled === true;
  const eduEmailDomain = typeof raw.eduEmailDomain === "string" ? raw.eduEmailDomain.trim().toLowerCase() : "";
  return {
    enabled,
    eduEmailDomain,
    requiresVerification: enabled,
  };
}

function slugifyGroupName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildSearchPrefixes(input: string): string[] {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, " ");
  const out = new Set<string>();
  for (const token of normalized.split(" ")) {
    if (!token) continue;
    for (let i = 1; i <= token.length; i += 1) out.add(token.slice(0, i));
  }
  return [...out].slice(0, 80);
}

function defaultGroupAnalytics(data: Record<string, unknown>) {
  const analytics = data.analytics && typeof data.analytics === "object" ? (data.analytics as Record<string, unknown>) : {};
  return {
    postsCount: toFiniteInt(analytics.postsCount, 0),
    activeMembers7d: toFiniteInt(analytics.activeMembers7d, 0),
    mappedPostsCount: toFiniteInt(analytics.mappedPostsCount, 0),
    totalLikes: toFiniteInt(analytics.totalLikes, 0),
    totalComments: toFiniteInt(analytics.totalComments, 0),
    placesCount: toFiniteInt(analytics.placesCount, 0),
    topActivities: Array.isArray(analytics.topActivities) ? analytics.topActivities.filter((v): v is string => typeof v === "string").slice(0, 8) : [],
    latestPostAt: toMillis(analytics.latestPostAt),
  };
}

export class GroupsRepository {
  constructor(private readonly adapter = new LegacyGroupsFirestoreAdapter()) {}

  private async loadMembershipGroupIds(userId: string): Promise<Set<string>> {
    const membershipIds = new Set<string>();
    if (!userId) return membershipIds;
    try {
      incrementDbOps("queries", 1);
      const membersSnap = await this.adapter.membersCollectionGroup().where("userId", "==", userId).get();
      incrementDbOps("reads", membersSnap.size);
      for (const doc of membersSnap.docs) {
        const groupId = doc.ref.parent.parent?.id ?? "";
        if (groupId) membershipIds.add(groupId);
      }
      return membershipIds;
    } catch {
      // Do not fail groups surfaces when collection-group indexes are missing in an environment.
      return membershipIds;
    }
  }

  private async loadUserSummary(userId: string): Promise<UserSummary> {
    const ref = this.adapter.user(userId);
    incrementDbOps("queries", 1);
    const snap = await ref.get();
    incrementDbOps("reads", 1);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    return {
      userId,
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : `User ${userId.slice(0, 8)}`,
      handle: typeof data.handle === "string" && data.handle.trim() ? data.handle.replace(/^@+/, "").trim() : `user_${userId.slice(0, 8)}`,
      profilePic:
        typeof data.profilePic === "string"
          ? data.profilePic
          : typeof data.profilePicture === "string"
            ? data.profilePicture
            : typeof data.photo === "string"
              ? data.photo
              : "",
    };
  }

  private async loadViewerPrimaryGroup(userId: string): Promise<GroupMembershipSummary | null> {
    incrementDbOps("queries", 1);
    const snap = await this.adapter.user(userId).get();
    incrementDbOps("reads", 1);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const primary = data.primaryGroup;
    if (!primary || typeof primary !== "object") return null;
    const raw = primary as Record<string, unknown>;
    const groupId = typeof raw.groupId === "string" ? raw.groupId.trim() : "";
    if (!groupId) return null;
    return {
      groupId,
      name: typeof raw.name === "string" ? raw.name : "",
      slug: typeof raw.slug === "string" ? raw.slug : "",
      photoUrl: typeof raw.photoUrl === "string" ? raw.photoUrl : "",
      role: raw.role === "owner" ? "owner" : "member",
      joinedAt: toMillis(raw.joinedAt) ?? Date.now(),
    };
  }

  async listMembershipsForProfile(userId: string): Promise<GroupMembershipSummary[]> {
    if (!userId) return [];
    const primary = await this.loadViewerPrimaryGroup(userId);
    const membershipIds = await this.loadMembershipGroupIds(userId);
    if (primary?.groupId) membershipIds.add(primary.groupId);
    const ids = [...membershipIds].slice(0, 24);
    if (ids.length === 0) return [];
    const docs = await Promise.all(ids.map((id) => this.adapter.group(id).get()));
    incrementDbOps("reads", docs.length);
    const out: GroupMembershipSummary[] = docs
      .filter((doc) => doc.exists)
      .map((doc) => {
        const data = (doc.data() ?? {}) as Record<string, unknown>;
        return {
          groupId: doc.id,
          name: typeof data.name === "string" ? data.name : "",
          slug: typeof data.slug === "string" ? data.slug : "",
          photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
          role: primary?.groupId === doc.id && primary.role === "owner" ? "owner" : "member",
          joinedAt: primary?.groupId === doc.id ? primary.joinedAt : 0,
        };
      });
    out.sort((a, b) => {
      if (primary?.groupId === a.groupId) return -1;
      if (primary?.groupId === b.groupId) return 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  async listForViewer(viewerId: string, limit: number, query?: string): Promise<GroupDirectoryRow[]> {
    const safeLimit = Math.max(1, Math.min(80, limit));
    const normalizedQuery = typeof query === "string" ? query.trim().toLowerCase() : "";
    const membershipIds = await this.loadMembershipGroupIds(viewerId);
    const primary = await this.loadViewerPrimaryGroup(viewerId);
    if (primary?.groupId) membershipIds.add(primary.groupId);

    incrementDbOps("queries", 1);
    const groupsSnap = normalizedQuery
      ? await this.adapter.groups().where("searchPrefixes", "array-contains", normalizedQuery).limit(120).get()
      : await this.adapter.groups().orderBy("updatedAt", "desc").limit(250).get();
    incrementDbOps("reads", groupsSnap.size);

    return groupsSnap.docs
      .map((doc) => {
        const data = (doc.data() ?? {}) as Record<string, unknown>;
        const college = normalizeCollege(data.college);
        const visibility = deriveVisibility(data);
        const isMember = membershipIds.has(doc.id);
        return {
          groupId: doc.id,
          name: typeof data.name === "string" ? data.name : "",
          slug: typeof data.slug === "string" ? data.slug : "",
          bio: typeof data.bio === "string" ? data.bio : "",
          photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
          memberCount: toFiniteInt(data.memberCount, 0),
          chatId: typeof data.chatId === "string" ? data.chatId : null,
          joinMode: visibility.joinMode,
          isPublic: visibility.isPublic,
          college,
          viewerMembership: {
            isMember,
            role: isMember && primary?.groupId === doc.id ? primary.role : undefined,
          },
        } satisfies GroupDirectoryRow;
      })
      .sort((a, b) => {
        if (a.viewerMembership.isMember && !b.viewerMembership.isMember) return -1;
        if (!a.viewerMembership.isMember && b.viewerMembership.isMember) return 1;
        return b.memberCount - a.memberCount || a.name.localeCompare(b.name);
      })
      .slice(0, safeLimit);
  }

  async create(input: {
    viewerId: string;
    name: string;
    bio?: string;
    photoUrl?: string | null;
    college?: { enabled: boolean; eduEmailDomain: string } | null;
  }): Promise<{ groupId: string; chatId: string | null }> {
    const viewerId = input.viewerId.trim();
    const name = input.name.trim();
    if (!viewerId || !name) throw new Error("group_create_invalid_input");
    const primary = await this.loadViewerPrimaryGroup(viewerId);
    if (primary?.groupId) {
      throw new Error("viewer_already_in_group");
    }
    const owner = await this.loadUserSummary(viewerId);
    const groups = this.adapter.groups();
    const slugBase = slugifyGroupName(name) || `group-${viewerId.slice(0, 6)}`;
    let slug = slugBase;
    for (let i = 0; i < 4; i += 1) {
      incrementDbOps("queries", 1);
      const snap = await groups.where("slug", "==", slug).limit(1).get();
      incrementDbOps("reads", snap.size);
      if (snap.empty) break;
      slug = `${slugBase}-${Math.floor(Math.random() * 900 + 100)}`;
    }
    const ref = groups.doc();
    const joinedAt = Date.now();
    const membership: GroupMembershipSummary = {
      groupId: ref.id,
      name,
      slug,
      photoUrl: typeof input.photoUrl === "string" ? input.photoUrl : "",
      role: "owner",
      joinedAt,
    };
    const batch = this.adapter.requireDb().batch();
    const college = input.college?.enabled
      ? {
          enabled: true,
          eduEmailDomain: String(input.college.eduEmailDomain ?? "").trim().toLowerCase(),
          requiresVerification: true,
        }
      : { enabled: false, eduEmailDomain: "", requiresVerification: false };
    batch.set(ref, {
      name,
      slug,
      normalizedName: name.toLowerCase(),
      bio: typeof input.bio === "string" ? input.bio.trim() : "",
      photoUrl: typeof input.photoUrl === "string" ? input.photoUrl : "",
      college,
      createdBy: viewerId,
      chatId: null,
      joinMode: "open",
      isPublic: true,
      memberCount: 1,
      membersPreview: [{ ...owner, role: "owner" }],
      searchPrefixes: buildSearchPrefixes(`${name} ${slug}`),
      analytics: {
        postsCount: 0,
        activeMembers7d: 1,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(this.adapter.groupMembers(ref.id).doc(viewerId), {
      ...owner,
      role: "owner",
      joinedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      this.adapter.user(viewerId),
      {
        primaryGroup: membership,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    incrementDbOps("writes", 3);
    await batch.commit();
    return { groupId: ref.id, chatId: null };
  }

  async update(input: {
    viewerId: string;
    groupId: string;
    name?: string;
    bio?: string;
    photoUrl?: string | null;
    joinMode?: "open" | "private";
    isPublic?: boolean;
    college?: { enabled: boolean; eduEmailDomain: string } | null;
  }): Promise<void> {
    const memberSnap = await this.adapter.groupMembers(input.groupId).doc(input.viewerId).get();
    incrementDbOps("reads", 1);
    if (!memberSnap.exists) throw new Error("group_member_required");
    const memberData = (memberSnap.data() ?? {}) as Record<string, unknown>;
    if (memberData.role !== "owner") throw new Error("group_owner_required");
    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (typeof input.name === "string" && input.name.trim()) {
      patch.name = input.name.trim();
      patch.normalizedName = input.name.trim().toLowerCase();
      patch.slug = slugifyGroupName(input.name.trim()) || input.groupId;
      patch.searchPrefixes = buildSearchPrefixes(`${patch.name as string} ${patch.slug as string}`);
    }
    if (typeof input.bio === "string") patch.bio = input.bio.trim();
    if (input.photoUrl !== undefined) patch.photoUrl = input.photoUrl ?? "";
    if (input.joinMode) patch.joinMode = input.joinMode;
    if (typeof input.isPublic === "boolean") patch.isPublic = input.isPublic;
    if (input.college) {
      patch.college = {
        enabled: input.college.enabled === true,
        eduEmailDomain: String(input.college.eduEmailDomain ?? "").trim().toLowerCase(),
        requiresVerification: input.college.enabled === true,
      };
    }
    incrementDbOps("writes", 1);
    await this.adapter.group(input.groupId).set(patch, { merge: true });
  }

  async getById(viewerId: string, groupId: string): Promise<GroupDetailRecord | null> {
    const [groupSnap, memberSnap, verificationSnap, membersSnap] = await Promise.all([
      this.adapter.group(groupId).get(),
      viewerId ? this.adapter.groupMembers(groupId).doc(viewerId).get() : Promise.resolve(null),
      viewerId ? this.adapter.groupVerifications(groupId).doc(viewerId).get() : Promise.resolve(null),
      this.adapter.groupMembers(groupId).limit(80).get(),
    ]);
    incrementDbOps("reads", 1 + (memberSnap ? 1 : 0) + (verificationSnap ? 1 : 0) + membersSnap.size);
    if (!groupSnap.exists) return null;
    const data = (groupSnap.data() ?? {}) as Record<string, unknown>;
    const college = normalizeCollege(data.college);
    const visibility = deriveVisibility(data);
    const memberDocs = membersSnap.docs;
    const members: GroupMemberRow[] = memberDocs.map((doc) => {
      const row = (doc.data() ?? {}) as Record<string, unknown>;
      return {
        userId: doc.id,
        name: typeof row.name === "string" ? row.name : `User ${doc.id.slice(0, 8)}`,
        handle: typeof row.handle === "string" ? row.handle.replace(/^@+/, "").trim() : `user_${doc.id.slice(0, 8)}`,
        profilePic: typeof row.profilePic === "string" ? row.profilePic : "",
        role: row.role === "owner" ? "owner" : "member",
        joinedAt: toMillis(row.joinedAt),
        xp: toFiniteInt(row.xp, 0),
        level: Math.max(1, toFiniteInt(row.level, 1)),
        tier: typeof row.tier === "string" && row.tier.trim() ? row.tier : "Beginner",
        postsCount: toFiniteInt(row.postsCount, 0),
      };
    });
    const membersPreview = members.slice(0, 5).map((member) => ({
      userId: member.userId,
      name: member.name,
      handle: member.handle,
      profilePic: member.profilePic,
      role: member.role,
    }));
    const viewerMembership: GroupDetailRecord["viewerMembership"] =
      memberSnap && memberSnap.exists
        ? {
            isMember: true,
            role: ((memberSnap.data() ?? {}) as Record<string, unknown>).role === "owner" ? "owner" : "member",
            joinedAt: toMillis(((memberSnap.data() ?? {}) as Record<string, unknown>).joinedAt) ?? undefined,
          }
        : { isMember: false };

    const chatIdForSync = typeof data.chatId === "string" ? data.chatId.trim() : "";
    if (viewerId && viewerMembership.isMember && chatIdForSync) {
      void this.ensureViewerInGroupChat(viewerId, chatIdForSync).catch(() => undefined);
    }

    return {
      groupId,
      name: typeof data.name === "string" ? data.name : "",
      slug: typeof data.slug === "string" ? data.slug : "",
      bio: typeof data.bio === "string" ? data.bio : "",
      photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
      memberCount: Math.max(members.length, toFiniteInt(data.memberCount, members.length)),
      chatId: typeof data.chatId === "string" ? data.chatId : null,
      createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
      createdAt: toMillis(data.createdAt),
      joinMode: visibility.joinMode,
      isPublic: visibility.isPublic,
      college: {
        ...college,
        viewerVerified: Boolean(verificationSnap?.exists),
        viewerVerifiedEmail:
          verificationSnap && verificationSnap.exists
            ? (verificationSnap.data() as Record<string, unknown>).email as string | undefined
            : undefined,
      },
      viewerMembership,
      membersPreview,
      members,
      analytics: defaultGroupAnalytics(data),
      achievements: {
        totalXp: 0,
        averageXp: 0,
        combinedTier: "Beginner",
        currentLeague: null,
        nextLeague: null,
        progress01: 0,
        globalRank: null,
        totalGroups: 0,
        leaderboard: [],
        leagueLeaderboard: [],
        postsLeaderboard: [],
        streakLeaderboard: [],
        currentWeekStreak: 0,
        topContributors: members.slice(0, 5),
      },
      competitions: {
        seasonLabel: "Current season",
        highlightMetric: "xp",
        customPrompt: "",
        byScope: {},
        pinnedRivals: [],
        availableScopes: [],
        availableTemplates: [],
      },
      posts: [],
      mapPoints: [],
    };
  }

  async join(input: { viewerId: string; groupId: string }): Promise<{ group: GroupMembershipSummary; chatId: string | null; alreadyJoined: boolean }> {
    const viewerId = input.viewerId.trim();
    const groupId = input.groupId.trim();
    if (!viewerId || !groupId) throw new Error("group_join_invalid_input");
    const [groupSnap, targetMemberSnap, verificationSnap, invitationSnap, existingMembersSnap] = await Promise.all([
      this.adapter.group(groupId).get(),
      this.adapter.groupMembers(groupId).doc(viewerId).get(),
      this.adapter.groupVerifications(groupId).doc(viewerId).get(),
      this.adapter.groupInvitations(groupId).doc(viewerId).get(),
      this.adapter.groupMembers(groupId).get(),
    ]);
    incrementDbOps("reads", 2 + existingMembersSnap.size + (verificationSnap.exists ? 1 : 0) + (invitationSnap.exists ? 1 : 0));
    if (!groupSnap.exists) throw new Error("missing_group");
    const data = (groupSnap.data() ?? {}) as Record<string, unknown>;
    const visibility = deriveVisibility(data);
    const college = normalizeCollege(data.college);
    const membership: GroupMembershipSummary = {
      groupId,
      name: typeof data.name === "string" ? data.name : "",
      slug: typeof data.slug === "string" ? data.slug : "",
      photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
      role: ((targetMemberSnap.data() ?? {}) as Record<string, unknown>).role === "owner" ? "owner" : "member",
      joinedAt: toMillis(((targetMemberSnap.data() ?? {}) as Record<string, unknown>).joinedAt) ?? Date.now(),
    };
    if (targetMemberSnap.exists) {
      return {
        group: membership,
        chatId: typeof data.chatId === "string" ? data.chatId : null,
        alreadyJoined: true,
      };
    }
    if (!visibility.isPublic && visibility.joinMode === "private" && !invitationSnap.exists) {
      throw new Error("invalid_or_expired_group_invite");
    }
    if (college.enabled && !verificationSnap.exists) {
      throw new Error("group_college_verification_required");
    }
    const summary = await this.loadUserSummary(viewerId);
    const membersPreview = Array.isArray(data.membersPreview) ? [...data.membersPreview] : [];
    if (!membersPreview.some((row) => row && typeof row === "object" && (row as { userId?: string }).userId === viewerId)) {
      membersPreview.push({ ...summary, role: "member" });
    }
    const batch = this.adapter.requireDb().batch();
    batch.set(this.adapter.groupMembers(groupId).doc(viewerId), {
      ...summary,
      role: "member",
      joinedAt: FieldValue.serverTimestamp(),
    });
    batch.set(
      this.adapter.group(groupId),
      {
        memberCount: FieldValue.increment(1),
        membersPreview: membersPreview.slice(0, 12),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      this.adapter.user(viewerId),
      {
        primaryGroup: {
          groupId,
          name: membership.name,
          slug: membership.slug,
          photoUrl: membership.photoUrl,
          role: "member",
          joinedAt: Date.now(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      this.adapter.groupInvitations(groupId).doc(viewerId),
      {
        userId: viewerId,
        status: "accepted",
        acceptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const chatId = typeof data.chatId === "string" ? data.chatId : null;
    if (chatId) {
      batch.set(
        this.adapter.chat(chatId),
        {
          participants: FieldValue.arrayUnion(viewerId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    incrementDbOps("writes", chatId ? 5 : 4);
    await batch.commit();
    return {
      group: {
        ...membership,
        role: "member",
        joinedAt: Date.now(),
      },
      chatId,
      alreadyJoined: false,
    };
  }

  async verifyCollegeEmail(input: {
    viewerId: string;
    groupId: string;
    email: string;
    method?: "email_entry" | "google";
  }): Promise<{ group: GroupMembershipSummary; chatId: string | null; verifiedEmail: string; alreadyJoined: boolean }> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("malformed_branch_params");
    const groupSnap = await this.adapter.group(input.groupId).get();
    incrementDbOps("reads", 1);
    if (!groupSnap.exists) throw new Error("missing_group");
    const data = (groupSnap.data() ?? {}) as Record<string, unknown>;
    const college = normalizeCollege(data.college);
    if (!college.enabled || !college.eduEmailDomain) {
      throw new Error("group_verification_not_required");
    }
    const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
    if (!domain || domain !== college.eduEmailDomain) {
      throw new Error("invalid_college_email");
    }
    incrementDbOps("writes", 1);
    await this.adapter.groupVerifications(input.groupId).doc(input.viewerId).set(
      {
        userId: input.viewerId,
        email,
        emailDomain: domain,
        method: input.method === "google" ? "google" : "email_entry",
        verifiedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const joined = await this.join({ viewerId: input.viewerId, groupId: input.groupId });
    return { ...joined, verifiedEmail: email };
  }

  async addMember(input: { viewerId: string; groupId: string; memberId: string }): Promise<void> {
    const ownerSnap = await this.adapter.groupMembers(input.groupId).doc(input.viewerId).get();
    incrementDbOps("reads", 1);
    if (!ownerSnap.exists || (ownerSnap.data() as Record<string, unknown> | undefined)?.role !== "owner") {
      throw new Error("group_owner_required");
    }
    await this.join({ viewerId: input.memberId, groupId: input.groupId });
  }

  async inviteMembers(input: { viewerId: string; groupId: string; memberIds: string[] }): Promise<{ invitedUserIds: string[]; skippedUserIds: string[] }> {
    const ownerSnap = await this.adapter.groupMembers(input.groupId).doc(input.viewerId).get();
    incrementDbOps("reads", 1);
    if (!ownerSnap.exists || (ownerSnap.data() as Record<string, unknown> | undefined)?.role !== "owner") {
      throw new Error("group_owner_required");
    }
    const groupSnap = await this.adapter.group(input.groupId).get();
    incrementDbOps("reads", 1);
    if (!groupSnap.exists) throw new Error("missing_group");
    const groupData = (groupSnap.data() ?? {}) as Record<string, unknown>;
    const invitedUserIds: string[] = [];
    const skippedUserIds: string[] = [];
    const batch = this.adapter.requireDb().batch();
    for (const memberId of [...new Set(input.memberIds.map((id) => id.trim()).filter(Boolean))]) {
      const existingMember = await this.adapter.groupMembers(input.groupId).doc(memberId).get();
      incrementDbOps("reads", 1);
      if (existingMember.exists) {
        skippedUserIds.push(memberId);
        continue;
      }
      batch.set(
        this.adapter.groupInvitations(input.groupId).doc(memberId),
        {
          userId: memberId,
          invitedBy: input.viewerId,
          status: "pending",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      invitedUserIds.push(memberId);
    }
    if (invitedUserIds.length > 0) {
      incrementDbOps("writes", invitedUserIds.length);
      await batch.commit();
    }
    void groupData;
    return { invitedUserIds, skippedUserIds };
  }

  async removeMember(input: { viewerId: string; groupId: string; memberId: string }): Promise<void> {
    const ownerSnap = await this.adapter.groupMembers(input.groupId).doc(input.viewerId).get();
    incrementDbOps("reads", 1);
    const isSelfRemoval = input.viewerId === input.memberId;
    const ownerData = (ownerSnap.data() ?? {}) as Record<string, unknown>;
    if (!isSelfRemoval && (!ownerSnap.exists || ownerData.role !== "owner")) {
      throw new Error("group_owner_required");
    }
    const memberSnap = await this.adapter.groupMembers(input.groupId).doc(input.memberId).get();
    incrementDbOps("reads", 1);
    if (!memberSnap.exists) return;
    const groupSnap = await this.adapter.group(input.groupId).get();
    incrementDbOps("reads", 1);
    if (!groupSnap.exists) throw new Error("missing_group");
    const groupData = (groupSnap.data() ?? {}) as Record<string, unknown>;
    const batch = this.adapter.requireDb().batch();
    batch.delete(this.adapter.groupMembers(input.groupId).doc(input.memberId));
    batch.set(
      this.adapter.group(input.groupId),
      {
        memberCount: FieldValue.increment(-1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      this.adapter.user(input.memberId),
      {
        primaryGroup: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const chatId = typeof groupData.chatId === "string" ? groupData.chatId : "";
    if (chatId) {
      batch.set(
        this.adapter.chat(chatId),
        {
          participants: FieldValue.arrayRemove(input.memberId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    incrementDbOps("writes", chatId ? 4 : 3);
    await batch.commit();
  }

  /**
   * Ensures the viewer is on the linked group chat's `participants` array so `/v2/chats/inbox` can find it.
   * Best-effort repair for members added before chat wiring or legacy imports (e.g. school groups).
   */
  async ensureViewerInGroupChat(viewerId: string, chatId: string | null): Promise<void> {
    const cid = (chatId ?? "").trim();
    const uid = viewerId.trim();
    if (!cid || !uid) return;
    try {
      incrementDbOps("queries", 1);
      const snap = await this.adapter.chat(cid).get();
      incrementDbOps("reads", 1);
      if (!snap.exists) return;
      const d = (snap.data() ?? {}) as Record<string, unknown>;
      const parts = Array.isArray(d.participants) ? d.participants.filter((x): x is string => typeof x === "string") : [];
      if (parts.includes(uid)) return;
      incrementDbOps("writes", 1);
      await this.adapter.chat(cid).set(
        {
          participants: FieldValue.arrayUnion(uid),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch {
      // best-effort
    }
  }

  /** Repair chat participants for all groups this user belongs to (capped). */
  async syncViewerIntoLinkedGroupChats(viewerId: string): Promise<void> {
    const uid = viewerId.trim();
    if (!uid) return;
    try {
      const membershipIds = await this.loadMembershipGroupIds(uid);
      const primary = await this.loadViewerPrimaryGroup(uid);
      if (primary?.groupId) membershipIds.add(primary.groupId);
      const ids = [...membershipIds].slice(0, 24);
      if (ids.length === 0) return;
      const groupSnaps = await Promise.all(ids.map((id) => this.adapter.group(id).get()));
      incrementDbOps("reads", groupSnaps.length);
      const uniqueChatIds = new Set<string>();
      for (const snap of groupSnaps) {
        if (!snap.exists) continue;
        const gd = (snap.data() ?? {}) as Record<string, unknown>;
        const cid = typeof gd.chatId === "string" ? gd.chatId.trim() : "";
        if (cid) uniqueChatIds.add(cid);
      }
      await Promise.all([...uniqueChatIds].map((cid) => this.ensureViewerInGroupChat(uid, cid)));
    } catch {
      // collection-group index may be missing in some environments
    }
  }

  async ensureShareLink(groupId: string): Promise<string> {
    const groupSnap = await this.adapter.group(groupId).get();
    incrementDbOps("reads", 1);
    if (!groupSnap.exists) throw new Error("missing_group");
    const data = (groupSnap.data() ?? {}) as Record<string, unknown>;
    const existing =
      typeof data.branchInviteUrl === "string" && data.branchInviteUrl.trim()
        ? data.branchInviteUrl.trim()
        : data.shareLinks && typeof (data.shareLinks as Record<string, unknown>).branchInvite === "string"
          ? String((data.shareLinks as Record<string, unknown>).branchInvite).trim()
          : "";
    if (existing) return existing;
    const publicBase = (
      process.env.BACKEND_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") ||
      process.env.EXPO_PUBLIC_WEB_APP_ORIGIN?.trim().replace(/\/$/, "") ||
      "https://locava.app"
    ).trim();
    const universalInviteUrl = `${publicBase}/groups/${encodeURIComponent(groupId)}`;

    const branchKey =
      process.env.BRANCH_API_KEY?.trim() ||
      process.env.EXPO_PUBLIC_BRANCH_API_KEY?.trim() ||
      process.env.BRANCH_KEY?.trim() ||
      "";
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const slug = typeof data.slug === "string" && data.slug.trim() ? data.slug.trim() : slugifyGroupName(name || groupId);
    const photoUrl = typeof data.photoUrl === "string" ? data.photoUrl.trim() : "";
    const bio = typeof data.bio === "string" ? data.bio.trim() : "";

    let url = "";
    if (branchKey) {
      try {
        const response = await fetch("https://api2.branch.io/v1/url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            branch_key: branchKey,
            channel: "group_share",
            feature: "invite",
            campaign: "group_invite",
            stage: "group",
            alias: slug ? `group-${slug}` : `group-${groupId}`,
            data: {
              invite_type: "group_invite",
              invite_token: `group:${groupId}`,
              group_id: groupId,
              group_name: name,
              group_slug: slug,
              group_photo_url: photoUrl,
              group_bio: bio,
              campaign: "group_invite",
              campus_id: groupId,
              distribution_surface: "group_share",
              qr_variant: "none",
              $canonical_identifier: `group-invite/${groupId}`,
              $og_title: name ? `Join ${name} on Locava` : "Join this group on Locava",
              $og_description: bio || "Join this group on Locava.",
              $og_image_url: photoUrl || undefined,
              $fallback_url: universalInviteUrl,
              $desktop_url: universalInviteUrl,
            },
          }),
        });
        const json = (await response.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
        const branchUrl = typeof json.url === "string" ? json.url.trim() : "";
        if (response.ok && branchUrl) {
          url = branchUrl;
        }
      } catch {
        url = "";
      }
    }
    if (!url) {
      url = universalInviteUrl;
    }
    const status = url === universalInviteUrl ? "universal_fallback" : "ready";
    incrementDbOps("writes", 1);
    await this.adapter.group(groupId).set(
      {
        branchInviteUrl: url,
        shareLinks: {
          branchInvite: url,
          branchInviteSavedAt: Date.now(),
          branchInviteStatus: status,
          branchInviteError: "",
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return url;
  }
}

export const groupsRepository = new GroupsRepository();
