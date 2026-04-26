import fs from "node:fs";
import path from "node:path";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";
import { mergeUserDocumentWritePayload } from "../../repositories/source-of-truth/user-document-firestore.adapter.js";

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

export function normalizeHandle(raw: string): string {
  return raw.replace(/^@+/, "").trim().toLowerCase();
}

export class AuthMutationsService {
  private readonly db = getFirestoreSourceClient();

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

  async createProfile(input: {
    userId: string;
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
    const payload = mergeUserDocumentWritePayload({
      name: input.name,
      handle: normalizedHandle,
      age: input.age,
      explorerLevel: input.explorerLevel ?? "",
      activityProfile: input.activityProfile ?? [],
      profilePic: input.profilePicture,
      phoneNumber: input.phoneNumber ?? "",
      school: input.school ?? "",
      relationshipRef: input.relationshipRef ?? "",
      onboardingComplete: true,
      branchData: input.branchData ?? null,
      oauthInfo: input.oauthInfo ?? null,
      updatedAt: Date.now(),
      createdAt: Date.now()
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
}
