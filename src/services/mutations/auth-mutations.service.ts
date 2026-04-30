import fs from "node:fs";
import path from "node:path";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { mergeUserDocumentWritePayload } from "../../repositories/source-of-truth/user-document-firestore.adapter.js";
import { getFirebaseAuthClient } from "../../repositories/source-of-truth/firebase-auth.client.js";

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

export class AuthMutationsService {
  private readonly db = getFirestoreSourceClient();
  private readonly auth = getFirebaseAuthClient();

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

  async createProfile(input: {
    userId: string;
    email?: string;
    name: string;
    age: number;
    explorerLevel?: string;
    activityProfile?: string[];
    profilePicture?: string;
    phoneNumber?: string;
    school?: string;
    handle?: string;
    relationshipRef?: string;
    branchData?: Record<string, unknown> | null;
    oauthInfo?: {
      provider: "google" | "apple";
      providerId: string;
      email: string;
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
    const payload = mergeUserDocumentWritePayload({
      ...(rawEmail.length > 0 ? { email: rawEmail.toLowerCase() } : {}),
      uid: input.userId,
      name: input.name,
      handle: normalizedHandle,
      age: input.age,
      explorerLevel: input.explorerLevel ?? "",
      activityProfile: input.activityProfile ?? [],
      profilePic: input.profilePicture,
      phoneNumber: input.phoneNumber ?? "",
      number: input.phoneNumber ?? "",
      school: input.school ?? "",
      relationshipRef: input.relationshipRef ?? null,
      profileComplete: true,
      onboardingComplete: true,
      notifications: [],
      savedPosts: [],
      topUsers: [],
      notifUnread: 0,
      notificationUnreadCount: 0,
      unreadNotificationCount: 0,
      unreadCount: 0,
      numFollowers: 0,
      followersCount: 0,
      numFollowing: 0,
      followingCount: 0,
      numPosts: 0,
      postCount: 0,
      postsCount: 0,
      postCountVerifiedValue: 0,
      postCountVerifiedAtMs: nowMs,
      settings: {},
      branchData: input.branchData ?? null,
      oauthInfo: input.oauthInfo ?? null,
      updatedAt: nowMs,
      createdAt: nowMs
    });

    let storage: "firestore" | "local_state_fallback" = "local_state_fallback";
    if (this.db) {
      try {
        await this.db.collection("users").doc(input.userId).set(payload, { merge: true });
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
    if (!this.db) {
      setAuthRuntimeBranch(input.viewerId, input.branchData);
      return { success: true, storage: "local_state_fallback" };
    }
    try {
      await this.db.collection("users").doc(input.viewerId).set({ branchData: input.branchData, updatedAt: Date.now() }, { merge: true });
      return { success: true, storage: "firestore" };
    } catch {
      setAuthRuntimeBranch(input.viewerId, input.branchData);
      return { success: true, storage: "local_state_fallback" };
    }
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
