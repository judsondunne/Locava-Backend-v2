import { FieldValue } from "firebase-admin/firestore";
import { incrementDbOps } from "../../observability/request-context.js";
import { AuthBranchAttributionFirestoreAdapter } from "../source-of-truth/auth-branch-attribution-firestore.adapter.js";

export type AuthBranchState = {
  exists: boolean;
  branchData: unknown;
  cohortKeys: string[];
  referredByUserId: string;
  name: string;
  handle: string;
};

export class AuthBranchAttributionRepository {
  constructor(private readonly adapter = new AuthBranchAttributionFirestoreAdapter()) {}

  isAvailable(): boolean {
    return this.adapter.isAvailable();
  }

  async loadUserState(userId: string): Promise<AuthBranchState> {
    incrementDbOps("queries", 1);
    const snap = await this.adapter.user(userId).get();
    incrementDbOps("reads", 1);
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    return {
      exists: snap.exists,
      branchData: data.branchData ?? null,
      cohortKeys: Array.isArray(data.cohortKeys) ? data.cohortKeys.filter((v): v is string => typeof v === "string") : [],
      referredByUserId: typeof data.referredByUserId === "string" ? data.referredByUserId.trim() : "",
      name: typeof data.name === "string" ? data.name : "",
      handle: typeof data.handle === "string" ? data.handle.replace(/^@+/, "").trim() : "",
    };
  }

  async mergeUserPatch(userId: string, patch: Record<string, unknown>): Promise<void> {
    incrementDbOps("writes", 1);
    await this.adapter.user(userId).set(
      {
        ...patch,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async incrementCohortCount(cohortKey: string, branchData: Record<string, unknown>): Promise<void> {
    const campaign = branchData.campaign != null ? String(branchData.campaign).trim() : "";
    const campusId = branchData.campus_id != null ? String(branchData.campus_id).trim() : "";
    incrementDbOps("writes", 1);
    await this.adapter.cohort(cohortKey).set(
      {
        campaign: campaign || null,
        campus_id: campusId || null,
        userCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  async incrementInviterReferralSignup(inviterUserId: string, inviteToken?: string): Promise<void> {
    incrementDbOps("writes", 1);
    await this.adapter.user(inviterUserId).set(
      {
        referralSignupCount: FieldValue.increment(1),
        challengeCounters: {
          referral_signup_count: FieldValue.increment(1),
        },
        lastReferralInviteToken: inviteToken ?? "",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}
