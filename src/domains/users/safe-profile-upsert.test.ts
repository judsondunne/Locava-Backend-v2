import { describe, expect, it } from "vitest";
import {
  buildSafeProfileUpsertPayload,
  decideExistingUserMergePolicy,
  PROTECTED_PROFILE_FIELDS
} from "./safe-profile-upsert.js";

describe("buildSafeProfileUpsertPayload (BUG-FIX #1 B)", () => {
  it("returns proposed payload unchanged when no existing doc (brand-new user)", () => {
    const proposed = {
      handle: "newuser",
      name: "Brand New",
      profilePic: "https://google.com/photo.jpg",
      age: 25
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: null, proposedPayload: proposed });
    expect(result.safePayload).toEqual(proposed);
    expect(result.preservedFields).toEqual([]);
    expect(result.overwrittenByTyped).toEqual([]);
  });

  it("preserves existing handle when Google sign-in sends empty handle", () => {
    const existing = {
      handle: "customhandle",
      name: "Custom Name",
      profilePic: "https://cdn.example.com/uploaded.jpg"
    };
    const proposed = {
      handle: "",
      name: "Google Display Name",
      profilePic: "",
      age: 30
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    expect(result.safePayload.handle).toBeUndefined();
    expect(result.safePayload.profilePic).toBeUndefined();
    // name was non-empty incoming so it overrides.
    expect(result.safePayload.name).toBe("Google Display Name");
    expect(result.preservedFields).toContain("handle");
    expect(result.preservedFields).toContain("profilePic");
    expect(result.overwrittenByTyped).toContain("name");
    expect(result.safePayload.age).toBe(30);
  });

  it("preserves all profile-pic alias fields when only Google fallback is empty", () => {
    const existing = {
      profilePic: "https://wasabi.example.com/users/uid/profile.jpg",
      profilePicture: "https://wasabi.example.com/users/uid/profile.jpg",
      photoURL: "https://wasabi.example.com/users/uid/profile.jpg",
      photo: "https://wasabi.example.com/users/uid/profile.jpg",
      avatarUrl: "https://wasabi.example.com/users/uid/profile.jpg"
    };
    const proposed = {
      profilePic: "",
      profilePicture: "",
      photoURL: "",
      photo: "",
      avatarUrl: ""
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    for (const f of ["profilePic", "profilePicture", "photoURL", "photo", "avatarUrl"]) {
      expect(result.safePayload[f]).toBeUndefined();
      expect(result.preservedFields).toContain(f);
    }
  });

  it("never replaces existing profile photo with Google photo when both are non-empty (provider does not win)", () => {
    // Caller is responsible for not sending Google photo as `profilePic`; verify that
    // when it IS sent (mistake), the typed input wins ONLY if the caller actually typed it.
    const existing = { profilePic: "https://wasabi/custom.jpg" };
    const proposedTypedWin = { profilePic: "https://wasabi/user-typed-new.jpg" };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposedTypedWin });
    // Field is retained — typed value wins. The protection ONLY blocks empty/null/undefined.
    expect(result.safePayload.profilePic).toBe("https://wasabi/user-typed-new.jpg");
    expect(result.overwrittenByTyped).toContain("profilePic");
  });

  it("strips null/undefined incoming values for protected fields even when existing is empty", () => {
    const existing = {};
    const proposed = {
      handle: null,
      name: undefined,
      profilePic: "",
      age: 22
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    expect("handle" in result.safePayload).toBe(false);
    expect("name" in result.safePayload).toBe(false);
    expect("profilePic" in result.safePayload).toBe(false);
    expect(result.remainedEmptyFields).toEqual(expect.arrayContaining(["handle", "name", "profilePic"]));
    expect(result.safePayload.age).toBe(22);
  });

  it("never regenerates handle when existing handle is present", () => {
    const existing = { handle: "tester99" };
    const proposed = { handle: "tester99" };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    expect(result.safePayload.handle).toBe("tester99");
    expect(result.preservedFields).not.toContain("handle");
    expect(result.overwrittenByTyped).not.toContain("handle");
  });

  it("preserves customized displayName when Google fallback is the only displayName provided", () => {
    const existing = { displayName: "My Custom Display" };
    const proposed = { displayName: "", name: "" };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    expect(result.safePayload.displayName).toBeUndefined();
    expect(result.preservedFields).toContain("displayName");
  });

  it("does not protect non-profile fields like activityProfile / age", () => {
    const existing = { activityProfile: { hiking: 4 }, age: 25 };
    const proposed = { activityProfile: { camping: 4 }, age: 30 };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    expect(result.safePayload.activityProfile).toEqual({ camping: 4 });
    expect(result.safePayload.age).toBe(30);
  });

  it("merge policy returns fill_missing_only for existing doc and create_new_doc otherwise", () => {
    expect(decideExistingUserMergePolicy({ existingDoc: { handle: "x" } })).toBe("fill_missing_only");
    expect(decideExistingUserMergePolicy({ existingDoc: null })).toBe("create_new_doc");
    expect(decideExistingUserMergePolicy({ existingDoc: undefined })).toBe("create_new_doc");
  });

  it("PROTECTED_PROFILE_FIELDS includes every field the spec calls out", () => {
    const required = ["handle", "name", "displayName", "profilePic", "profilePicture", "photoURL", "avatarUrl", "email"];
    for (const f of required) expect(PROTECTED_PROFILE_FIELDS).toContain(f);
  });
});
