import { beforeEach, describe, expect, it, vi } from "vitest";

type UserDoc = Record<string, unknown>;
type AuthUser = { uid: string; email?: string };

const state = {
  users: new Map<string, UserDoc>(),
  authUsersByEmail: new Map<string, AuthUser>(),
  authUsersByUid: new Map<string, AuthUser>(),
  writes: [] as Array<{ uid: string; payload: Record<string, unknown> }>,
  customTokens: [] as string[]
};

function resetState(): void {
  state.users.clear();
  state.authUsersByEmail.clear();
  state.authUsersByUid.clear();
  state.writes.length = 0;
  state.customTokens.length = 0;
}

function authUserNotFound(message = "auth/user-not-found"): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = "auth/user-not-found";
  return error;
}

function makeDoc(id: string, data: UserDoc | undefined) {
  return {
    id,
    exists: Boolean(data),
    data: () => data
  };
}

vi.mock("../../repositories/source-of-truth/firestore-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../repositories/source-of-truth/firestore-client.js")>();
  return {
    ...actual,
    getFirestoreAdminIdentity: () => ({
      projectId: "test-project",
      source: "vitest-mock"
    }),
    getFirestoreSourceClient: () => ({
      collection(name: string) {
        if (name !== "users") {
          throw new Error(`unexpected collection ${name}`);
        }
        return {
          doc(uid: string) {
            return {
              async get() {
                return makeDoc(uid, state.users.get(uid));
              },
              async set(payload: Record<string, unknown>) {
                const existing = state.users.get(uid) ?? {};
                const next = { ...existing, ...payload };
                state.users.set(uid, next);
                state.writes.push({ uid, payload });
              }
            };
          },
          where(field: string, op: string, value: string) {
            if (field !== "email" || op !== "==") {
              throw new Error(`unexpected query ${field} ${op}`);
            }
            return {
              limit() {
                return {
                  async get() {
                    const normalizedValue = value.trim().toLowerCase();
                    const match = [...state.users.entries()].find(([, data]) => {
                      return String(data.email ?? "").trim().toLowerCase() === normalizedValue;
                    });
                    return {
                      empty: !match,
                      docs: match ? [makeDoc(match[0], match[1])] : []
                    };
                  }
                };
              }
            };
          }
        };
      }
    })
  };
});

vi.mock("../../repositories/source-of-truth/firebase-auth.client.js", () => ({
  getFirebaseAuthClient: () => ({
    async createCustomToken(uid: string) {
      state.customTokens.push(uid);
      return `token:${uid}`;
    },
    async getUserByEmail(email: string) {
      const authUser = state.authUsersByEmail.get(email.trim().toLowerCase());
      if (!authUser) throw authUserNotFound();
      return authUser;
    },
    async getUser(uid: string) {
      const authUser = state.authUsersByUid.get(uid);
      if (!authUser) throw authUserNotFound();
      return authUser;
    }
  })
}));

describe("v2 auth mutation routes", () => {
  beforeEach(() => {
    resetState();
    vi.unstubAllGlobals();
  });

  async function createApp() {
    const { createApp: createBackendApp } = await import("../../app/createApp.js");
    return createBackendApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_TEST_MODE: "disabled" });
  }

  function stubIdpResponse(input: {
    providerUserId: string;
    email?: string;
    displayName?: string;
    localId: string;
    isNewUser: boolean;
  }): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.includes("accounts:signInWithIdp")) {
        throw new Error(`unexpected fetch ${url}`);
      }
      const rawUserInfo = JSON.stringify({
        id: input.providerUserId,
        ...(input.email ? { email: input.email } : {}),
        ...(input.displayName ? { name: input.displayName } : {})
      });
      return new Response(
        JSON.stringify({
          localId: input.localId,
          isNewUser: input.isNewUser,
          email: input.email,
          displayName: input.displayName,
          rawUserInfo
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }));
  }

  it("logs in an existing completed Google account", async () => {
    state.users.set("google_google-user-1", {
      email: "person@example.com",
      onboardingComplete: true,
      handle: "person"
    });
    stubIdpResponse({
      providerUserId: "google-user-1",
      email: "person@example.com",
      displayName: "Person",
      localId: "firebase-google-1",
      isNewUser: false
    });

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/google",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { accessToken: "google-access-token" }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.accountStatus).toBe("existing_complete");
      expect(body.data.onboardingRequired).toBe(false);
      expect(body.data.token).toBe("token:google_google-user-1");
      expect(state.writes).toHaveLength(0);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("routes a new Google identity into onboarding without creating a user doc", async () => {
    stubIdpResponse({
      providerUserId: "google-user-2",
      email: "new-google@example.com",
      displayName: "New Google",
      localId: "firebase-google-2",
      isNewUser: true
    });

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/google",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { accessToken: "google-access-token" }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.accountStatus).toBe("new_account_required");
      expect(body.data.isNewUser).toBe(true);
      expect(body.data.onboardingRequired).toBe(true);
      expect(body.data.token).toBeUndefined();
      expect(body.data.user.uid).toBe("google_google-user-2");
      expect(state.writes).toHaveLength(0);
      expect(state.customTokens).toHaveLength(0);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("logs in an existing completed Apple account", async () => {
    state.users.set("apple_apple-user-1", {
      email: "apple@example.com",
      onboardingComplete: true,
      handle: "apple-person"
    });
    stubIdpResponse({
      providerUserId: "apple-user-1",
      email: "apple@example.com",
      displayName: "Apple Person",
      localId: "firebase-apple-1",
      isNewUser: false
    });

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { identityToken: "apple-identity-token" }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.accountStatus).toBe("existing_complete");
      expect(body.data.token).toBe("token:apple_apple-user-1");
      expect(state.writes).toHaveLength(0);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("routes a new Apple identity into onboarding without creating a user doc", async () => {
    stubIdpResponse({
      providerUserId: "apple-user-2",
      email: "new-apple@example.com",
      displayName: "New Apple",
      localId: "firebase-apple-2",
      isNewUser: true
    });

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { identityToken: "apple-identity-token" }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.accountStatus).toBe("new_account_required");
      expect(body.data.isNewUser).toBe(true);
      expect(body.data.token).toBeUndefined();
      expect(body.data.user.uid).toBe("apple_apple-user-2");
      expect(state.writes).toHaveLength(0);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("returns onboarding-required for an existing incomplete OAuth account", async () => {
    state.users.set("google_google-user-3", {
      email: "resume@example.com",
      onboardingComplete: false,
      handle: "resume-user"
    });
    stubIdpResponse({
      providerUserId: "google-user-3",
      email: "resume@example.com",
      displayName: "Resume User",
      localId: "firebase-google-3",
      isNewUser: false
    });

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/google",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { accessToken: "google-access-token" }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.accountStatus).toBe("existing_incomplete");
      expect(body.data.onboardingRequired).toBe(true);
      expect(body.data.nativeDestinationRoute).toBe("onboarding_existing");
      expect(body.data.token).toBe("token:google_google-user-3");
    } finally {
      await app.close();
    }
  }, 15_000);

  it("reuses the existing email-linked uid during OAuth profile creation to avoid duplicates", async () => {
    state.users.set("existing-email-uid", {
      email: "linked@example.com",
      onboardingComplete: false,
      handle: "linked-user"
    });
    state.authUsersByEmail.set("linked@example.com", {
      uid: "existing-email-uid",
      email: "linked@example.com"
    });
    state.authUsersByUid.set("existing-email-uid", {
      uid: "existing-email-uid",
      email: "linked@example.com"
    });

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/profile",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: {
          userId: "google_google-user-4",
          name: "Linked User",
          age: 26,
          explorerLevel: "",
          activityProfile: ["hiking"],
          profilePicture: "",
          phoneNumber: "",
          school: "",
          handle: "linkeduser",
          oauthInfo: {
            provider: "google",
            providerId: "google-user-4",
            email: "linked@example.com",
            displayName: "Linked User"
          }
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.token).toBe("token:existing-email-uid");
      expect(state.writes.some((entry) => entry.uid === "existing-email-uid")).toBe(true);
      expect(state.writes.some((entry) => entry.uid === "google_google-user-4")).toBe(false);
    } finally {
      await app.close();
    }
  }, 15_000);
});
