import { InvitesRepository, type InviteResolvedGroup, type InviteResolvedInviter } from "../../repositories/surfaces/invites.repository.js";

function readInviteType(branchData: Record<string, unknown>): "user_invite" | "group_invite" {
  const inviteType = typeof branchData.invite_type === "string" ? branchData.invite_type.trim() : "";
  if (inviteType === "user_invite" || inviteType === "group_invite") return inviteType;
  throw new Error("malformed_branch_params");
}

function readInviteToken(branchData: Record<string, unknown>): string | null {
  return typeof branchData.invite_token === "string" && branchData.invite_token.trim()
    ? branchData.invite_token.trim()
    : null;
}

function readGroupId(branchData: Record<string, unknown>): string {
  const direct = typeof branchData.group_id === "string" ? branchData.group_id.trim() : "";
  if (direct) return direct;
  const token = readInviteToken(branchData) ?? "";
  if (token.startsWith("group:")) {
    const fromToken = token.slice("group:".length).trim();
    if (fromToken) return fromToken;
  }
  throw new Error("malformed_branch_params");
}

export class InvitesService {
  constructor(private readonly repository = new InvitesRepository()) {}

  async resolve(branchData: Record<string, unknown>): Promise<{
    inviteType: "user_invite" | "group_invite";
    inviteToken: string | null;
    inviter: InviteResolvedInviter | null;
    group: InviteResolvedGroup | null;
  }> {
    if (!branchData || typeof branchData !== "object" || Array.isArray(branchData) || Object.keys(branchData).length === 0) {
      throw new Error("malformed_branch_params");
    }
    const inviteType = readInviteType(branchData);
    const inviteToken = readInviteToken(branchData);
    if (inviteType === "user_invite") {
      const inviterUserId = typeof branchData.inviter_uid === "string" ? branchData.inviter_uid.trim() : "";
      if (!inviterUserId) throw new Error("malformed_branch_params");
      return {
        inviteType,
        inviteToken,
        inviter: await this.repository.loadInviter(branchData, inviterUserId),
        group: null,
      };
    }
    const groupId = readGroupId(branchData);
    const group = await this.repository.loadGroup(groupId);
    if (!group) throw new Error("invalid_or_expired_group_invite");
    return {
      inviteType,
      inviteToken,
      inviter: null,
      group,
    };
  }
}
