import { AuthBranchAttributionRepository } from "../../repositories/mutations/auth-branch-attribution.repository.js";

function stripRuntimeFields(branchData: Record<string, unknown>): Record<string, unknown> {
  const next = { ...branchData };
  delete next._capturedAtMs;
  return next;
}

function normalizeStoredBranchLinks(existing: unknown): Record<string, unknown>[] {
  if (!existing || typeof existing !== "object") return [];
  const raw = existing as Record<string, unknown>;
  if (Array.isArray(raw.links)) {
    return raw.links.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }
  return [raw];
}

function extractCohortKeyFromLink(link: Record<string, unknown> | null): string | null {
  if (!link) return null;
  const campaign = link.campaign != null ? String(link.campaign).trim() : "";
  const campusId = link.campus_id != null ? String(link.campus_id).trim() : "";
  const key = `${campaign}:${campusId}`;
  return key.length > 1 ? key : null;
}

function extractInviteReferralFields(link: Record<string, unknown> | null): {
  referredByUserId?: string;
  referredByHandle?: string;
  referredByName?: string;
  referredByProfilePic?: string;
  referralInviteType?: string;
  referralInviteToken?: string;
} {
  if (!link) return {};
  const inviteType = link.invite_type != null ? String(link.invite_type).trim() : "";
  const inviterUid = link.inviter_uid != null ? String(link.inviter_uid).trim() : "";
  if (inviteType !== "user_invite" || !inviterUid) return {};
  return {
    referredByUserId: inviterUid || undefined,
    referredByHandle: link.inviter_handle != null ? String(link.inviter_handle).trim() || undefined : undefined,
    referredByName: link.inviter_name != null ? String(link.inviter_name).trim() || undefined : undefined,
    referredByProfilePic: link.inviter_profile_pic != null ? String(link.inviter_profile_pic).trim() || undefined : undefined,
    referralInviteType: inviteType,
    referralInviteToken: link.invite_token != null ? String(link.invite_token).trim() || undefined : undefined,
  };
}

function linkIdentityKey(link: Record<string, unknown>): string {
  const inviteType = String(link.invite_type ?? "").trim();
  const inviteToken = String(link.invite_token ?? "").trim();
  const inviterUid = String(link.inviter_uid ?? "").trim();
  const groupId = String(link.group_id ?? "").trim();
  return JSON.stringify({
    inviteType,
    inviteToken,
    inviterUid,
    groupId,
    campaign: String(link.campaign ?? "").trim(),
    campusId: String(link.campus_id ?? "").trim(),
  });
}

export class AuthBranchAttributionService {
  constructor(private readonly repository = new AuthBranchAttributionRepository()) {}

  buildCreateProfileFields(branchData: Record<string, unknown> | null | undefined): Record<string, unknown> {
    if (!branchData || typeof branchData !== "object" || Object.keys(branchData).length === 0) {
      return { branchData: null, cohortKeys: [] };
    }
    const clean = stripRuntimeFields(branchData);
    const fields: Record<string, unknown> = {
      branchData: { links: [clean] },
      cohortKeys: (() => {
        const key = extractCohortKeyFromLink(clean);
        return key ? [key] : [];
      })(),
    };
    const referral = extractInviteReferralFields(clean);
    if (referral.referredByUserId) {
      fields.referredByUserId = referral.referredByUserId;
      fields.referredByHandle = referral.referredByHandle ?? "";
      fields.referredByName = referral.referredByName ?? "";
      fields.referredByProfilePic = referral.referredByProfilePic ?? "";
      fields.referralInviteType = referral.referralInviteType ?? "user_invite";
      fields.referralInviteToken = referral.referralInviteToken ?? "";
      fields.referredAt = Date.now();
    }
    return fields;
  }

  async mergeBranchDataIntoExistingUser(userId: string, branchData: Record<string, unknown> | null | undefined): Promise<{
    storage: "firestore" | "local_state_fallback";
    merged: boolean;
    normalizedBranchData: Record<string, unknown> | null;
  }> {
    if (!branchData || typeof branchData !== "object" || Object.keys(branchData).length === 0) {
      return { storage: this.repository.isAvailable() ? "firestore" : "local_state_fallback", merged: false, normalizedBranchData: null };
    }
    const clean = stripRuntimeFields(branchData);
    if (!this.repository.isAvailable()) {
      return { storage: "local_state_fallback", merged: false, normalizedBranchData: clean };
    }
    const current = await this.repository.loadUserState(userId);
    const existingLinks = normalizeStoredBranchLinks(current.branchData);
    const existingKeys = new Set(existingLinks.map(linkIdentityKey));
    const identity = linkIdentityKey(clean);
    const mergedLinks = existingKeys.has(identity) ? existingLinks : [...existingLinks, clean];
    const cohortKeys = [...current.cohortKeys];
    const cohortKey = extractCohortKeyFromLink(clean);
    if (cohortKey && !cohortKeys.includes(cohortKey)) {
      cohortKeys.push(cohortKey);
      await this.repository.incrementCohortCount(cohortKey, clean).catch(() => undefined);
    }
    const referral = extractInviteReferralFields(clean);
    const patch: Record<string, unknown> = {
      branchData: { links: mergedLinks },
      cohortKeys,
    };
    const shouldSetReferral = referral.referredByUserId && referral.referredByUserId !== current.referredByUserId;
    if (shouldSetReferral) {
      patch.referredByUserId = referral.referredByUserId;
      patch.referredByHandle = referral.referredByHandle ?? "";
      patch.referredByName = referral.referredByName ?? "";
      patch.referredByProfilePic = referral.referredByProfilePic ?? "";
      patch.referralInviteType = referral.referralInviteType ?? "user_invite";
      patch.referralInviteToken = referral.referralInviteToken ?? "";
      patch.referredAt = Date.now();
    }
    await this.repository.mergeUserPatch(userId, patch);
    if (shouldSetReferral && referral.referredByUserId) {
      await this.repository.incrementInviterReferralSignup(
        referral.referredByUserId,
        referral.referralInviteToken,
      ).catch(() => undefined);
    }
    return {
      storage: "firestore",
      merged: !existingKeys.has(identity),
      normalizedBranchData: clean,
    };
  }
}
