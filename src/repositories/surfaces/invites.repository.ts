import { incrementDbOps } from "../../observability/request-context.js";
import { LegacyGroupsFirestoreAdapter } from "../source-of-truth/legacy-groups-firestore.adapter.js";

export type InviteResolvedInviter = {
  userId: string;
  name: string;
  handle: string;
  profilePic: string | null;
  resolvedUserExists: boolean;
};

export type InviteResolvedGroup = {
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
};

function toFiniteInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

function normalizeVisibility(data: Record<string, unknown>): { joinMode: "open" | "private"; isPublic: boolean } {
  const joinMode = data.joinMode === "private" ? "private" : "open";
  const isPublic = typeof data.isPublic === "boolean" ? data.isPublic : joinMode === "open";
  return { joinMode: isPublic ? "open" : joinMode, isPublic };
}

function normalizeCollege(data: unknown): InviteResolvedGroup["college"] {
  const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const enabled = raw.enabled === true;
  const eduEmailDomain = typeof raw.eduEmailDomain === "string" ? raw.eduEmailDomain.trim().toLowerCase() : "";
  return {
    enabled,
    eduEmailDomain,
    requiresVerification: enabled,
  };
}

export class InvitesRepository {
  constructor(private readonly adapter = new LegacyGroupsFirestoreAdapter()) {}

  async loadInviter(branchData: Record<string, unknown>, inviterUserId: string): Promise<InviteResolvedInviter> {
    incrementDbOps("queries", 1);
    const snap = await this.adapter.user(inviterUserId).get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const fallbackName = typeof branchData.inviter_name === "string" ? branchData.inviter_name.trim() : "";
    const fallbackHandle = typeof branchData.inviter_handle === "string" ? String(branchData.inviter_handle).replace(/^@+/, "").trim() : "";
    const fallbackPic = typeof branchData.inviter_profile_pic === "string" ? branchData.inviter_profile_pic.trim() : "";
    return {
      userId: inviterUserId,
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : fallbackName,
      handle: typeof data.handle === "string" && data.handle.trim() ? data.handle.replace(/^@+/, "").trim() : fallbackHandle,
      profilePic:
        typeof data.profilePic === "string" && data.profilePic.trim()
          ? data.profilePic.trim()
          : fallbackPic || null,
      resolvedUserExists: snap.exists,
    };
  }

  async loadGroup(groupId: string): Promise<InviteResolvedGroup | null> {
    incrementDbOps("queries", 1);
    const snap = await this.adapter.group(groupId).get();
    incrementDbOps("reads", snap.exists ? 1 : 0);
    if (!snap.exists) return null;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    const visibility = normalizeVisibility(data);
    return {
      groupId: snap.id,
      name: typeof data.name === "string" ? data.name : "",
      slug: typeof data.slug === "string" ? data.slug : "",
      bio: typeof data.bio === "string" ? data.bio : "",
      photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
      memberCount: toFiniteInt(data.memberCount, 0),
      chatId: typeof data.chatId === "string" ? data.chatId : null,
      joinMode: visibility.joinMode,
      isPublic: visibility.isPublic,
      college: normalizeCollege(data.college),
    };
  }
}
