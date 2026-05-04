import { beforeEach, describe, expect, it, vi } from "vitest";

type UserDoc = Record<string, unknown>;
type AuthUser = { uid: string; email?: string };

type MockProviderData = { providerId: string; uid: string; email?: string };
type FirebaseUserMock = AuthUser & { displayName?: string | null; providerData?: MockProviderData[] };

const state = {
  users: new Map<string, UserDoc>(),
  authUsersByEmail: new Map<string, AuthUser>(),
  authUsersByUid: new Map<string, AuthUser>(),
  writes: [] as Array<{ uid: string; payload: Record<string, unknown> }>,
  customTokens: [] as string[],
  firebaseDecodedByToken: new Map<string, Record<string, unknown>>(),
  firebaseUserMocks: new Map<string, FirebaseUserMock>()
};

function resetState(): void {
  state.users.clear();
  state.authUsersByEmail.clear();
  state.authUsersByUid.clear();
  state.writes.length = 0;
  state.customTokens.length = 0;
  state.firebaseDecodedByToken.clear();
  state.firebaseUserMocks.clear();
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
    async verifyIdToken(token: string) {
      const decoded = state.firebaseDecodedByToken.get(token);
      if (!decoded) {
        throw new Error("invalid jwt decode");
      }
      return decoded;
    },
    async getUserByEmail(email: string) {
      const authUser = state.authUsersByEmail.get(email.trim().toLowerCase());
      if (!authUser) throw authUserNotFound();
      return authUser;
    },
    async getUser(uid: string) {
      const mockUser = state.firebaseUserMocks.get(uid);
      if (mockUser) {
        return {
          uid: mockUser.uid,
          email: mockUser.email ?? undefined,
          displayName: mockUser.displayName ?? undefined,
          providerData: mockUser.providerData ?? []
        };
      }
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
    process.env.FIREBASE_WEB_API_KEY = "test-api-key";
  });

  async function createApp() {
    const { createApp: createBackendApp } = await import("../../app/createApp.js");
    return createBackendApp({ NODE_ENV: "test", LOG_LEVEL: "silent", FIRESTORE_TEST_MODE: "disabled" });
  }

  function expectAppReadyContract(payload: any): void {
    expect(payload.accountStatus).toBe("existing_complete");
    expect(payload.nativeDestinationRoute).toBe("app");
    expect(payload.viewerReady).toBe(true);
    expect(payload.profileHydrationStatus).toBe("ready");
    expect(payload.profileComplete).toBe(true);
    expect(payload.onboardingComplete).toBe(true);
    expect(payload.requiresProfile).toBe(false);
    expect(payload.isNewUser).toBe(false);
    expect(typeof payload.canonicalUserId).toBe("string");
    expect(payload.viewer?.canonicalUserId).toBe(payload.canonicalUserId);
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

  function stubPasswordLoginResponse(input: {
    uid: string;
    email: string;
    displayName?: string;
  }): void {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.includes("accounts:signInWithPassword")) {
        throw new Error(`unexpected fetch ${url}`);
      }
      return new Response(
        JSON.stringify({
          localId: input.uid,
          email: input.email,
          displayName: input.displayName
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }));
  }

  it("returns full viewer hydration for existing email/password login", async () => {
    state.users.set("email-user-1", {
      email: "email@example.com",
      handle: "emailhandle",
      name: "Email User",
      profilePic: "https://cdn.example.com/p-medium.jpg",
      profilePicMediumPath: "https://cdn.example.com/p-medium.jpg",
      onboardingComplete: true,
      profileComplete: true
    });
    stubPasswordLoginResponse({
      uid: "email-user-1",
      email: "email@example.com",
      displayName: "Email User"
    });

    const app = await createApp();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/login",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: {
          email: "email@example.com",
          password: "pw-1234"
        }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(true);
      expectAppReadyContract(body.data);
      expect(body.data.viewer.viewerReady).toBe(true);
      expect(body.data.viewer.handle).toBe("emailhandle");
      expect(body.data.viewer.profilePic).toBe("https://cdn.example.com/p-medium.jpg");
      expect(body.data.viewer.profileHydrationStatus).toBe("ready");
      const sessionRes = await app.inject({
        method: "GET",
        url: "/v2/auth/session",
        headers: { "x-viewer-id": "email-user-1", "x-viewer-roles": "internal" }
      });
      expect(sessionRes.statusCode).toBe(200);
      const sessionBody = sessionRes.json();
      expect(sessionBody.data.firstRender.account.viewerReady).toBe(true);
      expect(sessionBody.data.firstRender.account.profileHydrationStatus).toBe("ready");
      expect(sessionBody.data.firstRender.viewer.photoUrl).toBe("https://cdn.example.com/p-medium.jpg");
      expect(sessionBody.data.firstRender.viewer.handle).toBe("emailhandle");
      expect(logSpy.mock.calls.some((entry) => String(entry[0]).includes("AUTH_SESSION_VIEWER_SUMMARY_TIMEOUT"))).toBe(false);
    } finally {
      logSpy.mockRestore();
      await app.close();
    }
  }, 15_000);

  it("logs in an existing completed Google account", async () => {
    state.users.set("google_google-user-1", {
      email: "person@example.com",
      onboardingComplete: true,
      handle: "person",
      profilePic: "https://cdn.example.com/google-person.jpg"
    });
    stubIdpResponse({
      providerUserId: "google-user-1",
      email: "person@example.com",
      displayName: "Person",
      localId: "firebase-google-1",
      isNewUser: false
    });

    const app = await createApp();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
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
      expectAppReadyContract(body.data);
      expect(body.data.accountStatus).toBe("existing_complete");
      expect(body.data.onboardingRequired).toBe(false);
      expect(body.data.token).toBe("token:google_google-user-1");
      expect(body.data.viewer.viewerReady).toBe(true);
      expect(body.data.viewer.canonicalUserId).toBe("google_google-user-1");
      const sessionRes = await app.inject({
        method: "GET",
        url: "/v2/auth/session",
        headers: { "x-viewer-id": "google_google-user-1", "x-viewer-roles": "internal" }
      });
      expect(sessionRes.statusCode).toBe(200);
      const sessionBody = sessionRes.json();
      expect(sessionBody.data.firstRender.account.viewerReady).toBe(true);
      expect(sessionBody.data.firstRender.account.profileHydrationStatus).toBe("ready");
      expect(sessionBody.data.firstRender.viewer.photoUrl).toBeTruthy();
      expect(sessionBody.data.firstRender.viewer.handle).toBeTruthy();
      expect(logSpy.mock.calls.some((entry) => String(entry[0]).includes("AUTH_SESSION_VIEWER_SUMMARY_TIMEOUT"))).toBe(false);
      expect(state.writes.some((entry) => entry.uid === "google_google-user-1")).toBe(true);
    } finally {
      logSpy.mockRestore();
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
      handle: "apple-person",
      profilePic: "https://cdn.example.com/apple-person.jpg"
    });
    stubIdpResponse({
      providerUserId: "apple-user-1",
      email: "apple@example.com",
      displayName: "Apple Person",
      localId: "firebase-apple-1",
      isNewUser: false
    });

    const app = await createApp();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
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
      expectAppReadyContract(body.data);
      expect(body.data.token).toBe("token:apple_apple-user-1");
      expect(body.data.viewer.viewerReady).toBe(true);
      expect(body.data.viewer.canonicalUserId).toBe("apple_apple-user-1");
      const sessionRes = await app.inject({
        method: "GET",
        url: "/v2/auth/session",
        headers: { "x-viewer-id": "apple_apple-user-1", "x-viewer-roles": "internal" }
      });
      expect(sessionRes.statusCode).toBe(200);
      const sessionBody = sessionRes.json();
      expect(sessionBody.data.firstRender.account.viewerReady).toBe(true);
      expect(sessionBody.data.firstRender.account.profileHydrationStatus).toBe("ready");
      expect(sessionBody.data.firstRender.viewer.photoUrl).toBeTruthy();
      expect(sessionBody.data.firstRender.viewer.handle).toBeTruthy();
      expect(logSpy.mock.calls.some((entry) => String(entry[0]).includes("AUTH_SESSION_VIEWER_SUMMARY_TIMEOUT"))).toBe(false);
      expect(state.writes.some((entry) => entry.uid === "apple_apple-user-1")).toBe(true);
    } finally {
      logSpy.mockRestore();
      await app.close();
    }
  }, 15_000);

  it("returns apple_token_verify_failed when Identity Toolkit rejects Apple JWT exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!url.includes("accounts:signInWithIdp")) throw new Error(`unexpected fetch ${url}`);
        return new Response(
          JSON.stringify({ error: { message: "INVALID_IDP_RESPONSE : Token malformed." } }),
          {
            status: 400,
            headers: { "content-type": "application/json" }
          }
        );
      })
    );

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { identityToken: "dummy-apple-token" }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(false);
      expect(body.data.errorCode).toBe("apple_token_verify_failed");
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });

  it("returns firebase_credential_exchange_failed when Identity Toolkit network fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("simulated_upstream_unreachable"))));

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { identityToken: "dummy-apple-token" }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.errorCode).toBe("firebase_credential_exchange_failed");
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });

  function fakeAppleJwtContainingNonce(payloadFields: Record<string, unknown>): string {
    const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url");
    const p = Buffer.from(JSON.stringify(payloadFields), "utf8").toString("base64url");
    return `${h}.${p}.stub`;
  }

  it("maps Identity Toolkit INVALID_IDP_RESPONSE audience mismatch to apple_token_audience_mismatch with diagnostics", async () => {
    const token = fakeAppleJwtContainingNonce({
      aud: "com.judsondunne.locava",
      sub: "native-apple-sub"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!url.includes("accounts:signInWithIdp")) throw new Error(`unexpected fetch ${url}`);
        return new Response(
          JSON.stringify({
            error: {
              message:
                'INVALID_IDP_RESPONSE : The audience in ID Token [com.judsondunne.locava] does not match the expected audience com.judsondunne.locava.web.'
            }
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      })
    );

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { identityToken: token }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(false);
      expect(body.data.errorCode).toBe("apple_token_audience_mismatch");
      expect(body.data.authDiagnostics?.appleTokenAudience).toBe("com.judsondunne.locava");
      expect(body.data.authDiagnostics?.recommendedFix).toBeTruthy();
      expect(body.data.authDiagnostics?.failurePhase).toBe("toolkit_exchange");
      expect(body.data.authDiagnostics?.oauthExchangeMode ?? "apple_identity_toolkit_rest").toBe(
        "apple_identity_toolkit_rest"
      );
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });

  it("maps Identity Toolkit MISSING_OR_INVALID_NONCE to apple_nonce_verify_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "MISSING_OR_INVALID_NONCE" } }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { identityToken: fakeAppleJwtContainingNonce({ sub: "subx" }), rawNonce: "1234567890abcdef" }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(false);
      expect(body.data.errorCode).toBe("apple_nonce_verify_failed");
      expect(body.data.authDiagnostics?.identityTokenJwtHasNonceClaim).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });

  it("authenticates apple via firebase_apple_via_client_exchange when Admin verifies firebaseIdToken + apple linkage", async () => {
    state.users.set("fb-apple-uid-77", {
      email: "fbapple77@example.com",
      onboardingComplete: true,
      handle: "fbapple77",
      profilePic: "https://cdn.example.com/fbapple77.jpg"
    });
    const fbSessionToken = "fb-session-token-apple-77";
    state.firebaseDecodedByToken.set(fbSessionToken, {
      uid: "fb-apple-uid-77",
      email: "fbapple77@example.com",
      firebase: { sign_in_provider: "apple.com" }
    });
    state.firebaseUserMocks.set("fb-apple-uid-77", {
      uid: "fb-apple-uid-77",
      email: "fbapple77@example.com",
      displayName: "FB Apple Tester",
      providerData: [{ providerId: "apple.com", uid: "apple-fed-77" }]
    });

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: {
          oauthExchangeMode: "firebase_apple_via_client_exchange",
          firebaseIdToken: fbSessionToken
        }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(true);
      expect(body.data.accountStatus).toBe("existing_complete");
      expect(body.data.token).toBe("token:fb-apple-uid-77");
      expect(body.data.viewer.canonicalUserId).toBe("fb-apple-uid-77");
    } finally {
      await app.close();
    }
  }, 15_000);

  it("returns missing_nonce when Apple JWT declares nonce hash but Backendv2 never receives rawNonce", async () => {
    const token = fakeAppleJwtContainingNonce({ nonce: "abc123hashedrepresentation" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("fetch_must_not_execute_before_nonce_precheck")))
    );

    const app = await createApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v2/auth/signin/apple",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { identityToken: token }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.success).toBe(false);
      expect(body.data.errorCode).toBe("missing_nonce");
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });

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

  it("rejects existing incomplete OAuth account until viewer is fully app-ready", async () => {
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
      expect(body.data.success).toBe(false);
      expect(body.data.error).toBe("signin_not_fully_ready");
      expect(body.data.reason).toBe("viewer_contract_incomplete");
      expect(body.data.accountStatus).toBe("existing_incomplete");
      expect(Array.isArray(body.data.failures)).toBe(true);
      expect(body.data.failures.length).toBeGreaterThan(0);
      expect(body.data.token).toBeUndefined();
    } finally {
      await app.close();
    }
  }, 15_000);

  it("keeps signup/login viewer response shapes compatible", async () => {
    state.users.set("shape-user-1", {
      email: "shape@example.com",
      handle: "shape",
      name: "Shape User",
      onboardingComplete: true,
      profileComplete: true,
      profilePic: "https://cdn.locava.dev/shape-user-1/profile.jpg"
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("accounts:signInWithPassword")) {
        return new Response(
          JSON.stringify({
            localId: "shape-user-1",
            email: "shape@example.com"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (url.includes("accounts:signUp")) {
        return new Response(
          JSON.stringify({
            localId: "shape-new-user",
            email: "newshape@example.com"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    const app = await createApp();
    try {
      const loginRes = await app.inject({
        method: "POST",
        url: "/v2/auth/login",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { email: "shape@example.com", password: "pw-1234" }
      });
      const registerRes = await app.inject({
        method: "POST",
        url: "/v2/auth/register",
        headers: { "content-type": "application/json", "x-viewer-roles": "internal" },
        payload: { email: "newshape@example.com", password: "pw-123456" }
      });
      expect(loginRes.statusCode).toBe(200);
      expect(registerRes.statusCode).toBe(200);
      expect(typeof loginRes.json().data.viewer).toBe("object");
      expect(typeof registerRes.json().data.viewer).toBe("object");
      expect(Object.keys(loginRes.json().data.viewer).sort()).toEqual(Object.keys(registerRes.json().data.viewer).sort());
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
      const writtenUser = state.users.get("existing-email-uid");
      expect(Array.isArray(writtenUser?.activityProfile)).toBe(false);
      expect(writtenUser?.activityProfile).toEqual({ hiking: 4 });
    } finally {
      await app.close();
    }
  }, 15_000);
});
