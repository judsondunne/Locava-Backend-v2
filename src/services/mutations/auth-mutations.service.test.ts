import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushBackgroundWorkForTests,
  getBackgroundWorkSnapshotForTests,
  resetBackgroundWorkForTests,
} from "../../lib/background-work.js";
import { AuthMutationsService } from "./auth-mutations.service.js";

afterEach(() => {
  resetBackgroundWorkForTests();
  vi.restoreAllMocks();
});

describe("AuthMutationsService push token persistence", () => {
  it("defers push-token persistence into background work for the background push-token lane", async () => {
    const set = vi.fn(async () => undefined);
    const service = new AuthMutationsService();
    (service as unknown as { db: unknown }).db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          set,
        })),
      })),
    };
    const claimExclusivePushTokens = vi
      .spyOn(service, "claimExclusivePushTokens")
      .mockImplementation(async () => undefined);

    const result = await service.persistViewerDevicePushTokens(
      "viewer-1",
      {
        expoPushToken: "ExponentPushToken[test-token]",
        pushToken: "ExponentPushToken[test-token]",
        pushTokenPlatform: "ios",
      },
      { deferPersist: true }
    );

    expect(result).toEqual({ persisted: true });
    expect(set).not.toHaveBeenCalled();
    expect(getBackgroundWorkSnapshotForTests().total).toBe(1);

    await flushBackgroundWorkForTests();

    expect(set).toHaveBeenCalledTimes(1);
    expect(claimExclusivePushTokens).toHaveBeenCalledTimes(1);
    expect(getBackgroundWorkSnapshotForTests().total).toBe(0);
  });
});

describe("AuthMutationsService.createProfile — Google sign-in identity preservation", () => {
  /**
   * Wires up a minimal Firestore mock that lets us:
   *   - return the existing user doc snapshot (or a missing doc) from `.get()`
   *   - capture the payload sent to `.set(payload, { merge: true })`
   * This proves that for an EXISTING user the Google-sign-in upsert does not include
   * the Locava-owned handle / username / name in the merge payload, and that for a
   * NEW user the proposed handle/name is allowed through.
   */
  function buildMockDb(existingDocData: Record<string, unknown> | null): {
    db: unknown;
    capturedSet: ReturnType<typeof vi.fn>;
  } {
    const capturedSet = vi.fn(async () => undefined);
    const db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: vi.fn(async () => ({
            exists: existingDocData != null,
            data: () => existingDocData ?? undefined,
          })),
          set: capturedSet,
        })),
      })),
    };
    return { db, capturedSet };
  }

  it("preserves an existing user's Locava handle/username when Google sign-in onboarding upserts", async () => {
    const existing = {
      uid: "uid-judson",
      handle: "judsonspots",
      userHandle: "judsonspots",
      username: "judson",
      userName: "judson",
      displayUsername: "judson",
      searchHandle: "judsonspots",
      name: "Judson",
      displayName: "Judson",
      searchName: "judson",
      email: "judson@locava.app",
      profilePic: "https://wasabi.locava.app/users/judson/profile.jpg",
      profilePicture: "https://wasabi.locava.app/users/judson/profile.jpg",
      photoURL: "https://wasabi.locava.app/users/judson/profile.jpg",
      avatarUrl: "https://wasabi.locava.app/users/judson/profile.jpg",
      onboardingComplete: false,
    };
    const { db, capturedSet } = buildMockDb(existing);
    const service = new AuthMutationsService();
    (service as unknown as { db: unknown }).db = db;
    vi.spyOn(service, "claimExclusivePushTokens").mockImplementation(async () => undefined);

    await service.createProfile({
      userId: "uid-judson",
      // Empty Locava handle/name simulate the worst-case Google fallback: Native sent
      // formData.handle === "" so the typed value is empty; the safe-upsert must not
      // let Google-derived values reach the protected fields.
      name: "",
      age: 25,
      handle: "",
      activityProfile: [],
      profilePicture: "",
      oauthInfo: {
        provider: "google",
        providerId: "google-oauth-uid",
        email: "judson@gmail.com",
        displayName: "Judson Dunne",
      },
    });

    expect(capturedSet).toHaveBeenCalledTimes(1);
    const firstCall = capturedSet.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = (firstCall?.[0] ?? {}) as Record<string, unknown>;
    // Critical assertions: none of the protected Locava-identity fields appear in the
    // merge payload — so merge:true cannot reach the stored values at all.
    for (const protectedField of [
      "handle",
      "userHandle",
      "username",
      "userName",
      "displayUsername",
      "searchHandle",
      "name",
      "displayName",
      "publicName",
      "searchName",
      "profilePic",
      "profilePicture",
      "photoURL",
      "photo",
      "avatarUrl",
    ]) {
      expect(
        Object.prototype.hasOwnProperty.call(payload, protectedField),
        `expected payload to not include protected field ${protectedField}, got ${JSON.stringify(
          payload[protectedField]
        )}`
      ).toBe(false);
    }
  });

  it("allows the typed username/handle through for a brand-new Google user (no existing doc)", async () => {
    const { db, capturedSet } = buildMockDb(null);
    const service = new AuthMutationsService();
    (service as unknown as { db: unknown }).db = db;
    vi.spyOn(service, "claimExclusivePushTokens").mockImplementation(async () => undefined);

    await service.createProfile({
      userId: "uid-newjudson",
      name: "New Judson",
      age: 21,
      handle: "newjudson",
      activityProfile: [],
      profilePicture: "",
      oauthInfo: {
        provider: "google",
        providerId: "google-oauth-uid-2",
        email: "newjudson@gmail.com",
        displayName: "New Judson",
      },
    });

    expect(capturedSet).toHaveBeenCalledTimes(1);
    const firstCall = capturedSet.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = (firstCall?.[0] ?? {}) as Record<string, unknown>;
    // For a brand new user, onboarding-typed handle/name DO appear and become the
    // source of truth. The user is then "rest of onboarding".
    expect(payload.handle).toBe("newjudson");
    expect(payload.name).toBe("New Judson");
  });

  it("preserves existing handle even when typed value differs (existing wins for protected fields with empty incoming)", async () => {
    // Subtle case: Native sends an empty handle. The safe-upsert must strip the empty
    // value so the existing handle is not even attempted to be overwritten.
    const existing = { handle: "judsonspots", name: "Judson" };
    const { db, capturedSet } = buildMockDb(existing);
    const service = new AuthMutationsService();
    (service as unknown as { db: unknown }).db = db;
    vi.spyOn(service, "claimExclusivePushTokens").mockImplementation(async () => undefined);

    await service.createProfile({
      userId: "uid-judson",
      name: "",
      age: 25,
      handle: "",
      activityProfile: [],
      profilePicture: "",
      oauthInfo: {
        provider: "google",
        providerId: "google-oauth-uid",
      },
    });

    const firstCall = capturedSet.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = (firstCall?.[0] ?? {}) as Record<string, unknown>;
    expect("handle" in payload).toBe(false);
    expect("name" in payload).toBe(false);
  });
});
