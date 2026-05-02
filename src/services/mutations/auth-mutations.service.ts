import fs from "node:fs";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { mergeUserDocumentWritePayload } from "../../repositories/source-of-truth/user-document-firestore.adapter.js";
import { getFirebaseAuthClient } from "../../repositories/source-of-truth/firebase-auth.client.js";
import { resolveProfilePicture } from "../../repositories/source-of-truth/profile-firestore.adapter.js";
import {
  buildCanonicalNewUserDocument,
  normalizeCanonicalUserDocument,
} from "../../domains/users/canonical-user-document.js";
import { AuthBranchAttributionService } from "./auth-branch-attribution.service.js";

type AuthRuntimeState = {
  profilesByUid: Record<string, { handle: string; name: string; updatedAtMs: number; branchData?: Record<string, unknown> | null }>;
};

const AUTH_RUNTIME_STATE_PATH = path.resolve(process.cwd(), "state", "auth-runtime-state.json");

function readAuthRuntimeState(): AuthRuntimeState {
  try {
    const raw = fs.readFileSync(AUTH_RUNTIME_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as AuthRuntimeState;
    if (!parsed || typeof parsed !== "object" || !parsed.profilesByUid || typeof parsed.profilesByUid !== "object") {
      return { profilesByUid: {} };
    }
    return parsed;
  } catch {
    return { profilesByUid: {} };
  }
}

function writeAuthRuntimeState(state: AuthRuntimeState): void {
  fs.mkdirSync(path.dirname(AUTH_RUNTIME_STATE_PATH), { recursive: true });
  fs.writeFileSync(AUTH_RUNTIME_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function setAuthRuntimeProfile(uid: string, profile: { handle: string; name: string; branchData?: Record<string, unknown> | null }): void {
  const state = readAuthRuntimeState();
  state.profilesByUid[uid] = {
    handle: profile.handle,
    name: profile.name,
    branchData: profile.branchData ?? null,
    updatedAtMs: Date.now()
  };
  writeAuthRuntimeState(state);
}

function setAuthRuntimeBranch(uid: string, branchData: Record<string, unknown>): void {
  const state = readAuthRuntimeState();
  const existing = state.profilesByUid[uid] ?? { handle: `user_${uid.slice(0, 8)}`, name: "User", updatedAtMs: Date.now() };
  state.profilesByUid[uid] = {
    ...existing,
    branchData,
    updatedAtMs: Date.now()
  };
  writeAuthRuntimeState(state);
}

function hasAuthRuntimeProfile(uid: string): boolean {
  const state = readAuthRuntimeState();
  return Boolean(state.profilesByUid[uid]);
}

function clearAuthRuntimeProfile(uid: string): boolean {
  const state = readAuthRuntimeState();
  if (!state.profilesByUid[uid]) return false;
  delete state.profilesByUid[uid];
  writeAuthRuntimeState(state);
  return true;
}

function isFirebaseAuthUserMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    code?: string;
    errorInfo?: { code?: string };
    message?: string;
    hasCode?: (code: string) => boolean;
  };
  const code = anyErr.code ?? anyErr.errorInfo?.code ?? "";
  if (code === "auth/user-not-found" || code === "auth/not-found") {
    return true;
  }
  if (typeof anyErr.hasCode === "function" && (anyErr.hasCode("user-not-found") || anyErr.hasCode("not-found"))) {
    return true;
  }
  const msg = String(anyErr.message ?? "").toLowerCase();
  return msg.includes("no user record") && msg.includes("identifier");
}

function summarizeMutationError(err: unknown): { code?: string; message?: string } | null {
  if (err == null) return null;
  if (typeof err !== "object") return { message: String(err).slice(0, 240) };
  const e = err as { code?: string | number; message?: string };
  const code = e.code !== undefined && e.code !== null ? String(e.code) : undefined;
  return {
    code,
    message: typeof e.message === "string" ? e.message.slice(0, 240) : undefined
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** gRPC / Firestore codes that are worth retrying for delete-account. */
function isFirestoreRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: number | string; message?: string };
  if (typeof e.code === "number") {
    // 4 DEADLINE_EXCEEDED, 8 RESOURCE_EXHAUSTED, 10 ABORTED, 13 INTERNAL, 14 UNAVAILABLE
    return [2, 4, 8, 10, 13, 14].includes(e.code);
  }
  if (typeof e.code === "string") {
    const u = e.code.toUpperCase();
    if (["UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "ABORTED", "INTERNAL", "UNKNOWN"].includes(u)) {
      return true;
    }
  }
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("unavailable") ||
    msg.includes("deadline exceeded") ||
    msg.includes("resource exhausted") ||
    msg.includes("try again") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout")
  );
}

function isAuthDeleteTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  const code = e.code ?? "";
  if (
    code === "auth/internal-error" ||
    code === "auth/network-request-failed" ||
    code === "UNAVAILABLE" ||
    code === "DEADLINE_EXCEEDED"
  ) {
    return true;
  }
  const msg = String(e.message ?? "").toLowerCase();
  return msg.includes("unavailable") || msg.includes("internal error") || msg.includes("econnreset") || msg.includes("socket");
}

function isFirestoreNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: number | string; message?: string };
  if (anyErr.code === 5 || anyErr.code === "NOT_FOUND") return true;
  const msg = typeof anyErr.message === "string" ? anyErr.message : "";
  return msg.includes("NOT_FOUND");
}

export function normalizeHandle(raw: string): string {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

export type OauthAccountStatus =
  | "existing_complete"
  | "existing_incomplete"
  | "new_account_required";

export type OauthExistingMatchSource =
  | "firebase_uid_user_doc"
  | "legacy_provider_uid_user_doc"
  | "email_user_doc"
  | "firebase_auth_email_user_doc"
  | "firebase_auth_email_only"
  | "provider_auth_only";

type UserDocSummary = {
  uid: string;
  email: string | null;
  onboardingComplete: boolean;
};

export type CanonicalViewerHydration = {
  uid: string;
  canonicalUserId: string;
  email: string | null;
  handle: string | null;
  name: string | null;
  profilePic: string | null;
  profilePicSmallPath: string | null;
  profilePicMediumPath: string | null;
  profilePicLargePath: string | null;
  onboardingComplete: boolean | null;
  profileComplete: boolean | null;
  locationPreferences: Record<string, unknown> | null;
  searchPreferences: Record<string, unknown> | null;
  viewerReady: boolean;
  profileHydrationStatus: "ready" | "minimal_fallback";
  userDocFound: boolean;
};

export class AuthMutationsService {
  private readonly db = getFirestoreSourceClient();
  private readonly auth = getFirebaseAuthClient();
  private readonly branchAttributionService = new AuthBranchAttributionService();

  async isHandleAvailable(rawHandle: string): Promise<{ available: boolean; normalizedHandle: string }> {
    const normalizedHandle = normalizeHandle(rawHandle);
    if (!this.db) {
      return { available: true, normalizedHandle };
    }
    const snap = await this.db.collection("users").where("searchHandle", "==", normalizedHandle).limit(1).get();
    return {
      available: snap.empty,
      normalizedHandle
    };
  }

  async userDocExists(uid: string): Promise<boolean> {
    if (!this.db) return hasAuthRuntimeProfile(uid);
    try {
      const doc = await this.db.collection("users").doc(uid).get();
      return doc.exists || hasAuthRuntimeProfile(uid);
    } catch {
      return hasAuthRuntimeProfile(uid);
    }
  }

  async userDocExistsByEmail(email: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return false;
    if (!this.db) return false;
    try {
      const snap = await this.db.collection("users").where("email", "==", normalizedEmail).limit(1).get();
      return !snap.empty;
    } catch {
      return false;
    }
  }

  async authUserExistsByEmail(email: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !this.auth) return false;
    try {
      await this.auth.getUserByEmail(normalizedEmail);
      return true;
    } catch (error) {
      if (isFirebaseAuthUserMissing(error)) return false;
      return false;
    }
  }

  private makeOauthUid(provider: "google" | "apple", providerId: string): string {
    return `${provider}_${providerId}`;
  }

  private normalizeEmail(raw: string | null | undefined): string | null {
    if (typeof raw !== "string") return null;
    const normalized = raw.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private toUserDocSummary(uid: string, data: Record<string, unknown> | undefined): UserDocSummary {
    const email = this.normalizeEmail(typeof data?.email === "string" ? data.email : null);
    const onboardingComplete = !(data?.profileComplete === false || data?.onboardingComplete === false);
    return {
      uid,
      email,
      onboardingComplete
    };
  }

  async getUserDocSummary(uid: string): Promise<UserDocSummary | null> {
    const normalizedUid = uid.trim();
    if (!normalizedUid || !this.db) return null;
    try {
      const doc = await this.db.collection("users").doc(normalizedUid).get();
      if (!doc.exists) return null;
      return this.toUserDocSummary(normalizedUid, (doc.data() as Record<string, unknown> | undefined) ?? undefined);
    } catch {
      return null;
    }
  }

  async getUserDocSummaryByEmail(email: string | null | undefined): Promise<UserDocSummary | null> {
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedEmail || !this.db) return null;
    try {
      const snap = await this.db.collection("users").where("email", "==", normalizedEmail).limit(1).get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      if (!doc) return null;
      return this.toUserDocSummary(doc.id, (doc.data() as Record<string, unknown> | undefined) ?? undefined);
    } catch {
      return null;
    }
  }

  async getCanonicalViewerHydration(uid: string): Promise<CanonicalViewerHydration> {
    const canonicalUserId = uid.trim();
    if (!canonicalUserId || !this.db) {
      return {
        uid: canonicalUserId,
        canonicalUserId,
        email: null,
        handle: null,
        name: null,
        profilePic: null,
        profilePicSmallPath: null,
        profilePicMediumPath: null,
        profilePicLargePath: null,
        onboardingComplete: null,
        profileComplete: null,
        locationPreferences: null,
        searchPreferences: null,
        viewerReady: false,
        profileHydrationStatus: "minimal_fallback",
        userDocFound: false
      };
    }

    try {
      const doc = await this.db.collection("users").doc(canonicalUserId).get();
      if (!doc.exists) {
        return {
          uid: canonicalUserId,
          canonicalUserId,
          email: null,
          handle: null,
          name: null,
          profilePic: null,
          profilePicSmallPath: null,
          profilePicMediumPath: null,
          profilePicLargePath: null,
          onboardingComplete: null,
          profileComplete: null,
          locationPreferences: null,
          searchPreferences: null,
          viewerReady: false,
          profileHydrationStatus: "minimal_fallback",
          userDocFound: false
        };
      }
      const rawData = ((doc.data() as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
      if (Array.isArray(rawData.activityProfile)) {
        console.warn("USER_DOC_SHAPE_INVALID", {
          userId: canonicalUserId,
          rawActivityProfileType: "array",
        });
      }
      const data = normalizeCanonicalUserDocument(rawData);
      const shouldRepairShape =
        Array.isArray(rawData.activityProfile) ||
        typeof rawData.settings !== "object" ||
        rawData.settings == null ||
        typeof rawData.onboardingComplete !== "boolean" ||
        typeof rawData.profileComplete !== "boolean" ||
        typeof rawData.searchHandle !== "string" ||
        typeof rawData.searchName !== "string";
      if (shouldRepairShape) {
        await this.db.collection("users").doc(canonicalUserId).set(
          {
            activityProfile: data.activityProfile,
            searchHandle: typeof data.searchHandle === "string" ? data.searchHandle : data.handle,
            searchName: typeof data.searchName === "string" ? data.searchName : String(data.name ?? "").toLowerCase(),
            settings: data.settings && typeof data.settings === "object" ? data.settings : {},
            onboardingComplete: data.onboardingComplete !== false,
            profileComplete: data.profileComplete !== false,
            profilePic: typeof data.profilePic === "string" ? data.profilePic : "",
            profilePicture: typeof data.profilePicture === "string" ? data.profilePicture : "",
            photoURL: typeof data.photoURL === "string" ? data.photoURL : "",
            avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : "",
            updatedAt: Date.now()
          },
          { merge: true }
        ).catch(() => undefined);
        console.log(
          JSON.stringify({
            event: "USER_DOC_SHAPE_REPAIRED_ON_LOGIN",
            ts: Date.now(),
            userId: canonicalUserId,
            repairedActivityProfileArray: Array.isArray(rawData.activityProfile),
            repairedSettings: !(rawData.settings && typeof rawData.settings === "object"),
            repairedBooleans:
              typeof rawData.onboardingComplete !== "boolean" || typeof rawData.profileComplete !== "boolean"
          })
        );
      }
      const picture = resolveProfilePicture({
        profilePicPath: typeof data.profilePicPath === "string" ? data.profilePicPath : undefined,
        profilePicLargePath: typeof data.profilePicLargePath === "string" ? data.profilePicLargePath : undefined,
        profilePicLarge: typeof data.profilePicLarge === "string" ? data.profilePicLarge : undefined,
        profilePic: typeof data.profilePic === "string" ? data.profilePic : undefined,
        profilePicture: typeof data.profilePicture === "string" ? data.profilePicture : undefined,
        profilePicSmallPath: typeof data.profilePicSmallPath === "string" ? data.profilePicSmallPath : undefined,
        profilePicSmall: typeof data.profilePicSmall === "string" ? data.profilePicSmall : undefined,
        photo: typeof data.photo === "string" ? data.photo : undefined,
        photoURL: typeof data.photoURL === "string" ? data.photoURL : undefined,
        avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : undefined
      });
      return {
        uid: canonicalUserId,
        canonicalUserId,
        email: this.normalizeEmail(typeof data.email === "string" ? data.email : null),
        handle: typeof data.handle === "string" && data.handle.trim() ? data.handle.trim() : null,
        name:
          typeof data.name === "string" && data.name.trim()
            ? data.name.trim()
            : typeof data.displayName === "string" && data.displayName.trim()
              ? data.displayName.trim()
              : null,
        profilePic: picture.url,
        profilePicSmallPath: picture.profilePicSmallPath,
        profilePicMediumPath:
          typeof data.profilePicMediumPath === "string" && data.profilePicMediumPath.trim()
            ? data.profilePicMediumPath.trim()
            : null,
        profilePicLargePath: picture.profilePicLargePath,
        onboardingComplete: typeof data.onboardingComplete === "boolean" ? data.onboardingComplete : null,
        profileComplete: typeof data.profileComplete === "boolean" ? data.profileComplete : null,
        locationPreferences: asRecord(data.locationPreferences ?? data.locationPrefs ?? null),
        searchPreferences: asRecord(data.searchPreferences ?? data.searchPrefs ?? null),
        viewerReady: true,
        profileHydrationStatus: "ready",
        userDocFound: true
      };
    } catch {
      return {
        uid: canonicalUserId,
        canonicalUserId,
        email: null,
        handle: null,
        name: null,
        profilePic: null,
        profilePicSmallPath: null,
        profilePicMediumPath: null,
        profilePicLargePath: null,
        onboardingComplete: null,
        profileComplete: null,
        locationPreferences: null,
        searchPreferences: null,
        viewerReady: false,
        profileHydrationStatus: "minimal_fallback",
        userDocFound: false
      };
    }
  }

  async resolveOauthAccount(input: {
    provider: "google" | "apple";
    providerId: string;
    firebaseUid: string;
    email?: string | null;
    idpIsNewUser?: boolean | null;
  }): Promise<{
    resolvedUid: string;
    accountStatus: OauthAccountStatus;
    onboardingComplete: boolean | null;
    matchedUser: UserDocSummary | null;
    matchedBy: OauthExistingMatchSource | null;
    providerUidPresent: boolean;
    emailPresent: boolean;
  }> {
    const providerUidPresent = input.providerId.trim().length > 0;
    const email = this.normalizeEmail(input.email);
    const emailPresent = Boolean(email);
    const legacyOauthUid = this.makeOauthUid(input.provider, input.providerId);

    const exactDoc = await this.getUserDocSummary(input.firebaseUid);
    if (exactDoc) {
      return {
        resolvedUid: exactDoc.uid,
        accountStatus: exactDoc.onboardingComplete ? "existing_complete" : "existing_incomplete",
        onboardingComplete: exactDoc.onboardingComplete,
        matchedUser: exactDoc,
        matchedBy: "firebase_uid_user_doc",
        providerUidPresent,
        emailPresent
      };
    }

    if (legacyOauthUid !== input.firebaseUid) {
      const legacyDoc = await this.getUserDocSummary(legacyOauthUid);
      if (legacyDoc) {
        return {
          resolvedUid: legacyDoc.uid,
          accountStatus: legacyDoc.onboardingComplete ? "existing_complete" : "existing_incomplete",
          onboardingComplete: legacyDoc.onboardingComplete,
          matchedUser: legacyDoc,
          matchedBy: "legacy_provider_uid_user_doc",
          providerUidPresent,
          emailPresent
        };
      }
    }

    if (email) {
      const emailDoc = await this.getUserDocSummaryByEmail(email);
      if (emailDoc) {
        return {
          resolvedUid: emailDoc.uid,
          accountStatus: emailDoc.onboardingComplete ? "existing_complete" : "existing_incomplete",
          onboardingComplete: emailDoc.onboardingComplete,
          matchedUser: emailDoc,
          matchedBy: "email_user_doc",
          providerUidPresent,
          emailPresent
        };
      }
    }

    if (email && this.auth) {
      try {
        const authUser = await this.auth.getUserByEmail(email);
        const authDoc = await this.getUserDocSummary(authUser.uid);
        if (authDoc) {
          return {
            resolvedUid: authDoc.uid,
            accountStatus: authDoc.onboardingComplete ? "existing_complete" : "existing_incomplete",
            onboardingComplete: authDoc.onboardingComplete,
            matchedUser: authDoc,
            matchedBy: "firebase_auth_email_user_doc",
            providerUidPresent,
            emailPresent
          };
        }

        if (authUser.uid !== input.firebaseUid || input.idpIsNewUser === false) {
          return {
            resolvedUid: authUser.uid,
            accountStatus: "existing_incomplete",
            onboardingComplete: false,
            matchedUser: null,
            matchedBy: "firebase_auth_email_only",
            providerUidPresent,
            emailPresent
          };
        }
      } catch (error) {
        if (!isFirebaseAuthUserMissing(error)) {
          throw error;
        }
      }
    }

    if (input.idpIsNewUser === false) {
      return {
        resolvedUid: input.firebaseUid,
        accountStatus: "existing_incomplete",
        onboardingComplete: false,
        matchedUser: null,
        matchedBy: "provider_auth_only",
        providerUidPresent,
        emailPresent
      };
    }

    return {
      resolvedUid: legacyOauthUid,
      accountStatus: "new_account_required",
      onboardingComplete: false,
      matchedUser: null,
      matchedBy: null,
      providerUidPresent,
      emailPresent
    };
  }

  async resolveCreateProfileUser(input: {
    requestedUserId: string;
    oauthInfo?: {
      provider: "google" | "apple";
      providerId: string;
      email?: string;
      displayName?: string;
    } | null;
  }): Promise<{
    resolvedUid: string;
    accountStatus: OauthAccountStatus;
    matchedBy: OauthExistingMatchSource | null;
    matchedUser: UserDocSummary | null;
  }> {
    const requestedUserId = input.requestedUserId.trim();
    if (!requestedUserId || !input.oauthInfo) {
      return {
        resolvedUid: requestedUserId,
        accountStatus: "new_account_required",
        matchedBy: null,
        matchedUser: null
      };
    }

    const resolution = await this.resolveOauthAccount({
      provider: input.oauthInfo.provider,
      providerId: input.oauthInfo.providerId,
      firebaseUid: requestedUserId,
      email: input.oauthInfo.email ?? null,
      idpIsNewUser: null
    });

    if (resolution.accountStatus === "new_account_required") {
      if (this.auth) {
        try {
          await this.auth.getUser(requestedUserId);
          return {
            resolvedUid: requestedUserId,
            accountStatus: "existing_incomplete",
            matchedBy: "provider_auth_only",
            matchedUser: null
          };
        } catch (error) {
          if (!isFirebaseAuthUserMissing(error)) {
            throw error;
          }
        }
      }
      return {
        resolvedUid: requestedUserId,
        accountStatus: "new_account_required",
        matchedBy: null,
        matchedUser: null
      };
    }

    return {
      resolvedUid: resolution.resolvedUid,
      accountStatus: resolution.accountStatus,
      matchedBy: resolution.matchedBy,
      matchedUser: resolution.matchedUser
    };
  }

  async createProfile(input: {
    userId: string;
    email?: string;
    name: string;
    age: number;
    explorerLevel?: string;
    activityProfile?: string[] | Record<string, number>;
    selectedActivities?: string[];
    profilePicture?: string;
    phoneNumber?: string;
    school?: string;
    handle?: string;
    relationshipRef?: string;
    branchData?: Record<string, unknown> | null;
    expoPushToken?: string;
    pushToken?: string;
    pushTokenPlatform?: string;
    oauthInfo?: {
      provider: "google" | "apple";
      providerId: string;
      email?: string;
      displayName?: string;
    };
  }): Promise<{ success: true; handle: string; storage: "firestore" | "local_state_fallback" }> {
    const normalizedHandle = normalizeHandle(input.handle ?? input.name);
    const nowMs = Date.now();
    const rawEmail =
      typeof input.email === "string" && input.email.trim().length > 0
        ? input.email.trim()
        : typeof input.oauthInfo?.email === "string" && input.oauthInfo.email.trim().length > 0
          ? input.oauthInfo.email.trim()
          : "";
    const expoPushToken =
      typeof input.expoPushToken === "string" && input.expoPushToken.trim().length > 0
        ? input.expoPushToken.trim()
        : "";
    const pushToken =
      typeof input.pushToken === "string" && input.pushToken.trim().length > 0
        ? input.pushToken.trim()
        : expoPushToken;
    const pushTokenPlatform =
      typeof input.pushTokenPlatform === "string" && input.pushTokenPlatform.trim().length > 0
        ? input.pushTokenPlatform.trim()
        : "";
    const attributionFields = this.branchAttributionService.buildCreateProfileFields(input.branchData ?? null);
    const payload = mergeUserDocumentWritePayload({
      ...buildCanonicalNewUserDocument({
        uid: input.userId,
        email: rawEmail,
        name: input.name,
        handle: normalizedHandle,
        age: input.age,
        explorerLevel: input.explorerLevel ?? "",
        selectedActivities: input.selectedActivities ?? input.activityProfile ?? [],
        profilePic: input.profilePicture,
        phoneNumber: input.phoneNumber ?? "",
        relationshipRef: input.relationshipRef ?? null,
        branchData: input.branchData ?? null,
        school: input.school ?? "",
        oauthInfo: input.oauthInfo ?? null,
        nowMs,
      }),
      topUsers: [],
      unreadNotificationCount: 0,
      unreadCount: 0,
      postCountVerifiedValue: 0,
      postCountVerifiedAtMs: nowMs,
      ...(expoPushToken ? { expoPushToken } : {}),
      ...(pushToken ? { pushToken } : {}),
      ...(pushTokenPlatform ? { pushTokenPlatform } : {}),
      ...(pushToken ? { pushTokenUpdatedAt: nowMs } : {}),
    });
    console.info("USER_CREATE_CANONICAL_SHAPE", {
      userId: input.userId,
      hasEmail: rawEmail.length > 0,
      hasOauthInfo: Boolean(input.oauthInfo),
    });
    console.info("USER_CREATE_ACTIVITY_PROFILE_NORMALIZED", {
      userId: input.userId,
      rawType: Array.isArray(input.activityProfile) ? "array" : typeof input.activityProfile,
      normalizedCount: Object.keys((payload.activityProfile as Record<string, unknown>) ?? {}).length,
    });
    Object.assign(payload, attributionFields);

    let storage: "firestore" | "local_state_fallback" = "local_state_fallback";
    if (this.db) {
      try {
        await this.db.collection("users").doc(input.userId).set(
          {
            ...payload,
            ...(expoPushToken ? { expoPushTokens: FieldValue.arrayUnion(expoPushToken) } : {}),
            ...(pushToken ? { pushTokens: FieldValue.arrayUnion(pushToken) } : {}),
          },
          { merge: true }
        );
        storage = "firestore";
      } catch {
        setAuthRuntimeProfile(input.userId, {
          handle: normalizedHandle,
          name: input.name,
          branchData: input.branchData ?? null
        });
      }
    } else {
      setAuthRuntimeProfile(input.userId, {
        handle: normalizedHandle,
        name: input.name,
        branchData: input.branchData ?? null
      });
    }

    return {
      success: true,
      handle: normalizedHandle,
      storage
    };
  }

  async mergeProfileBranch(input: {
    viewerId: string;
    branchData: Record<string, unknown>;
  }): Promise<{ success: true; storage: "firestore" | "local_state_fallback" }> {
    const result = await this.branchAttributionService.mergeBranchDataIntoExistingUser(
      input.viewerId,
      input.branchData,
    );
    if (result.storage === "local_state_fallback") {
      setAuthRuntimeBranch(input.viewerId, input.branchData);
    }
    return { success: true, storage: result.storage };
  }

  async signOutViewer(viewerId: string): Promise<{ clearedPushToken: boolean }> {
    if (!viewerId || viewerId === "anonymous") {
      throw new Error("viewer_id_required");
    }
    if (!this.db) {
      return { clearedPushToken: false };
    }
    try {
      await this.db.collection("users").doc(viewerId).set(
        {
          expoPushToken: null,
          expoPushTokens: [],
          pushToken: null,
          pushTokens: [],
          updatedAt: Date.now()
        },
        { merge: true }
      );
      return { clearedPushToken: true };
    } catch {
      return { clearedPushToken: false };
    }
  }

  async deleteViewerAccount(
    viewerId: string
  ): Promise<{ deletedUserDoc: boolean; deletedAuthUser: boolean; revokedSessions: boolean }> {
    if (!viewerId || viewerId === "anonymous") {
      throw new Error("viewer_id_required");
    }

    let deletedUserDoc = false;
    let deletedAuthUser = false;
    let revokedSessions = false;
    let lastFirestoreError: unknown;
    let lastAuthDeleteError: unknown;

    if (this.db) {
      const userRef = this.db.collection("users").doc(viewerId);
      const maxFirestoreAttempts = 3;
      for (let attempt = 0; attempt < maxFirestoreAttempts && !deletedUserDoc; attempt++) {
        if (attempt > 0) {
          await sleepMs(90 + attempt * 110);
        }
        try {
          const userSnap = await userRef.get();
          if (!userSnap.exists) {
            deletedUserDoc = true;
            break;
          }
          const handle = typeof userSnap.data()?.handle === "string" ? userSnap.data()?.handle : null;
          try {
            // Plain root delete only — avoid recursiveDelete (bulk subtree) flakiness.
            await userRef.delete();
          } catch (delErr) {
            lastFirestoreError = delErr;
            if (isFirestoreNotFound(delErr)) {
              // already gone
            } else if (isFirestoreRetryable(delErr) && attempt < maxFirestoreAttempts - 1) {
              continue;
            } else {
              throw delErr;
            }
          }
          if (handle && handle.trim()) {
            await this.db.collection("handles").doc(handle.trim().toLowerCase()).delete().catch(() => undefined);
          }
          deletedUserDoc = true;
          break;
        } catch (err) {
          lastFirestoreError = err;
          if (isFirestoreNotFound(err)) {
            deletedUserDoc = true;
            break;
          }
          if (!isFirestoreRetryable(err) || attempt === maxFirestoreAttempts - 1) {
            break;
          }
        }
      }
      // If reads failed transiently, root delete may still succeed (delete does not require a prior get).
      if (!deletedUserDoc) {
        try {
          await userRef.delete();
          deletedUserDoc = true;
        } catch (blindErr) {
          lastFirestoreError = lastFirestoreError ?? blindErr;
          if (isFirestoreNotFound(blindErr)) {
            deletedUserDoc = true;
          }
        }
      }
    }

    if (this.auth) {
      try {
        await this.auth.revokeRefreshTokens(viewerId);
        revokedSessions = true;
      } catch {
        revokedSessions = false;
      }
      const maxAuthAttempts = 3;
      for (let attempt = 0; attempt < maxAuthAttempts && !deletedAuthUser; attempt++) {
        if (attempt > 0) {
          await sleepMs(90 + attempt * 110);
        }
        try {
          await this.auth.deleteUser(viewerId);
          deletedAuthUser = true;
          break;
        } catch (err) {
          lastAuthDeleteError = err;
          if (isFirebaseAuthUserMissing(err)) {
            deletedAuthUser = true;
            break;
          }
          if (!isAuthDeleteTransient(err) || attempt === maxAuthAttempts - 1) {
            break;
          }
        }
      }
    }

    // Email/password reuse requires Firebase Auth user removal — never report success if Auth delete failed.
    if (this.auth && !deletedAuthUser) {
      throw new Error("delete_account_auth_failed", {
        cause: {
          viewerIdSuffix: viewerId.length > 6 ? viewerId.slice(-6) : viewerId,
          authDelete: summarizeMutationError(lastAuthDeleteError)
        }
      });
    }
    // Without Admin SDK we cannot remove the Identity Toolkit user; Firestore-only delete would leave email blocked.
    if (!this.auth && deletedUserDoc) {
      throw new Error("delete_account_auth_admin_unavailable", {
        cause: {
          viewerIdSuffix: viewerId.length > 6 ? viewerId.slice(-6) : viewerId,
          hint: "Configure Firebase Admin credentials so Auth users can be deleted."
        }
      });
    }

    let removedLocalRuntimeProfile = false;
    if (!this.db) {
      removedLocalRuntimeProfile = clearAuthRuntimeProfile(viewerId);
    } else if (deletedUserDoc || deletedAuthUser) {
      clearAuthRuntimeProfile(viewerId);
    }

    if (!deletedUserDoc && !deletedAuthUser && !removedLocalRuntimeProfile) {
      throw new Error("delete_account_failed", {
        cause: {
          viewerIdSuffix: viewerId.length > 6 ? viewerId.slice(-6) : viewerId,
          hasFirestore: Boolean(this.db),
          hasAuthAdmin: Boolean(this.auth),
          firestore: summarizeMutationError(lastFirestoreError),
          authDelete: summarizeMutationError(lastAuthDeleteError)
        }
      });
    }
    return { deletedUserDoc, deletedAuthUser, revokedSessions };
  }
}
