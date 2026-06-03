import { describe, expect, it } from "vitest";
import {
  buildSafeProfileUpsertPayload,
  decideExistingUserMergePolicy,
  PROTECTED_PROFILE_FIELDS,
  PROTECTED_LOCAVA_USERNAME_HANDLE_FIELDS,
  summarizeLocavaIdentityPresence
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

  it("preserves existing handle/name when Google sign-in sends Google-derived values", () => {
    // BUG-FIX: locked-down identity preservation. createProfile must NEVER overwrite
    // an existing Locava-owned protected field even when the incoming value looks
    // "typed" — the Native onboarding fallback ladder can construct an incoming value
    // from Google's displayName / email prefix, and that must not reach Firestore.
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
    // Existing name is preserved even when incoming name looks "typed". The Native
    // onboarding fallback ladder treats Google displayName as a typed value when
    // formData.name is empty; this protection refuses that overwrite.
    expect(result.safePayload.name).toBeUndefined();
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

  it("never replaces existing profile photo with any incoming profile-pic value during createProfile", () => {
    // Locked-down policy: createProfile is not an edit-profile path. Even when the
    // proposed photo URL looks user-typed (non-empty, non-Google), the existing photo
    // is preserved. The dedicated edit-profile pipeline is responsible for legitimate
    // photo edits and does not route through this helper.
    const existing = { profilePic: "https://wasabi/custom.jpg" };
    const proposedTypedWin = { profilePic: "https://wasabi/user-typed-new.jpg" };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposedTypedWin });
    expect("profilePic" in result.safePayload).toBe(false);
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
    // Equal incoming + existing value is treated as a no-op preservation (no
    // overwrite, no rewrite). The helper records this as `preservedFields` so the
    // log clearly reports "existing handle was preserved" even when the strings match.
    const existing = { handle: "tester99" };
    const proposed = { handle: "tester99" };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    expect("handle" in result.safePayload).toBe(false);
    expect(result.preservedFields).toContain("handle");
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

describe("Google sign-in identity preservation — explicit user scenarios", () => {
  // The Native EndStep / SuccessScreen onboarding handlers may compose a Google sign-in
  // payload using `formData.name || oauthInfo.displayName || oauthInfo.email.split('@')[0]`.
  // For an existing Locava user re-routed through onboarding (existing_incomplete),
  // the backend MUST refuse to overwrite the stored Locava-owned username / handle
  // even if every Native fallback resolves to Google-derived data.

  it("scenario 1: existing Google user with Locava username/handle is fully preserved", () => {
    // Before sign-in (Firestore truth):
    //   username = "judson"
    //   userHandle = "judsonspots"
    const existing = {
      handle: "judsonspots",
      userHandle: "judsonspots",
      username: "judson",
      userName: "judson",
      displayUsername: "judson",
      searchHandle: "judsonspots",
      name: "Judson",
      displayName: "Judson",
      searchName: "judson",
      email: "judson@locava.app"
    };
    // Google profile that Native would forward via the createProfile onboarding
    // payload when formData.name is empty and the fallback ladder reaches
    // oauthInfo.displayName / email prefix:
    //   displayName = "Judson Dunne"
    //   email = "judson@gmail.com"
    const proposedFromGoogle = {
      handle: "judsondunne",
      userHandle: "judsondunne",
      username: "judson", // happens to match — still preserved as no-op
      userName: "judsondunne",
      displayUsername: "judsondunne",
      searchHandle: "judsondunne",
      name: "Judson Dunne",
      displayName: "Judson Dunne",
      searchName: "judson dunne",
      email: "judson@gmail.com"
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposedFromGoogle });
    // After Google sign-in / createProfile upsert: username is still "judson",
    // userHandle is still "judsonspots". No Google-derived value reached the payload.
    for (const field of PROTECTED_LOCAVA_USERNAME_HANDLE_FIELDS) {
      expect(field in result.safePayload).toBe(false);
    }
    for (const field of ["name", "displayName", "searchName", "email"]) {
      expect(field in result.safePayload).toBe(false);
    }
  });

  it("scenario 1 (bug-reproduction): empty Google payload cannot wipe Locava username/handle", () => {
    // Bug reproduction: pre-fix, an upsert that included the protected fields with
    // empty / null / undefined values would clobber the existing stored values via
    // merge:true. After the fix, every empty incoming protected field is stripped.
    const existing = {
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
      avatarUrl: "https://wasabi.locava.app/users/judson/profile.jpg"
    };
    const proposedEmptyFromProvider = {
      handle: "",
      userHandle: null,
      username: undefined,
      userName: "",
      displayUsername: "",
      searchHandle: "",
      name: "",
      displayName: null,
      searchName: "",
      email: "",
      profilePic: "",
      profilePicture: "",
      photoURL: "",
      avatarUrl: ""
    };
    const result = buildSafeProfileUpsertPayload({
      existingDoc: existing,
      proposedPayload: proposedEmptyFromProvider
    });
    for (const field of [
      "handle",
      "userHandle",
      "username",
      "userName",
      "displayUsername",
      "searchHandle",
      "name",
      "displayName",
      "searchName",
      "email",
      "profilePic",
      "profilePicture",
      "photoURL",
      "avatarUrl"
    ]) {
      // Every protected field is stripped so merge:true cannot overwrite the stored
      // Locava-owned value with an empty / provider-fallback value.
      expect(field in result.safePayload).toBe(false);
      expect(result.preservedFields).toContain(field);
    }
  });

  it("scenario 2: existing user's profile pic remains unchanged after Google sign-in upsert", () => {
    const existing = {
      handle: "judsonspots",
      profilePic: "https://wasabi.locava.app/users/judson/profile-large.jpg",
      profilePicture: "https://wasabi.locava.app/users/judson/profile-large.jpg",
      photoURL: "https://wasabi.locava.app/users/judson/profile-large.jpg",
      avatarUrl: "https://wasabi.locava.app/users/judson/profile-large.jpg",
      photo: "https://wasabi.locava.app/users/judson/profile-large.jpg"
    };
    const proposedFromGoogle = {
      handle: "",
      // Even if Native somehow forwarded the Google photoURL, the existing custom photo
      // must win when the proposed value is provider-derived and "empty enough" (this
      // also belt-and-suspenders verifies the photo-aliases protection is still wired).
      profilePic: "",
      profilePicture: "",
      photoURL: "",
      avatarUrl: "",
      photo: ""
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposedFromGoogle });
    for (const f of ["profilePic", "profilePicture", "photoURL", "avatarUrl", "photo"]) {
      expect(f in result.safePayload).toBe(false);
      expect(result.preservedFields).toContain(f);
    }
  });

  it("scenario 3: brand-new Google user — onboarding flow remains the source of truth", () => {
    // No existing user doc → caller is responsible for creating one from the payload.
    // The proposed payload is what onboarding would send AFTER the user typed their
    // Locava handle in the NameSet flow. We verify the safe-upsert helper does NOT
    // strip the typed handle/name (it is the *only* place that handle/name come from
    // for a new user, since the auth route never wrote either field).
    const proposedFromOnboarding = {
      uid: "uid-newgoogle",
      handle: "newjudson",
      userHandle: "newjudson",
      username: "newjudson",
      searchHandle: "newjudson",
      name: "New Judson",
      displayName: "New Judson",
      searchName: "new judson",
      profilePic: "",
      email: "newjudson@gmail.com"
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: null, proposedPayload: proposedFromOnboarding });
    expect(result.safePayload).toEqual(proposedFromOnboarding);
    expect(result.preservedFields).toEqual([]);
    expect(result.overwrittenByTyped).toEqual([]);
  });

  it("scenario 4 (Apple regression): same protection applies for Apple sign-in upserts", () => {
    const existing = {
      handle: "applefan",
      userHandle: "applefan",
      name: "Apple Fan",
      displayName: "Apple Fan"
    };
    const proposedFromApple = {
      handle: "",
      userHandle: "",
      name: "",
      displayName: ""
    };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposedFromApple });
    expect(result.safePayload.handle).toBeUndefined();
    expect(result.safePayload.userHandle).toBeUndefined();
    expect(result.safePayload.name).toBeUndefined();
    expect(result.safePayload.displayName).toBeUndefined();
    expect(result.preservedFields).toEqual(expect.arrayContaining(["handle", "userHandle", "name", "displayName"]));
  });

  it("scenario 4 (email/password regression): empty provider-style payload preserves typed identity", () => {
    const existing = { handle: "emailuser", name: "Email User" };
    const proposed = { handle: "", name: "" };
    const result = buildSafeProfileUpsertPayload({ existingDoc: existing, proposedPayload: proposed });
    expect(result.safePayload.handle).toBeUndefined();
    expect(result.safePayload.name).toBeUndefined();
    expect(result.preservedFields).toEqual(expect.arrayContaining(["handle", "name"]));
  });
});

describe("PROTECTED_PROFILE_FIELDS — Locava-owned identity coverage", () => {
  it("includes every Locava-owned username/handle alias the bug spec calls out", () => {
    const requiredHandleAliases = [
      "handle",
      "userHandle",
      "username",
      "userName",
      "displayUsername",
      "searchHandle"
    ];
    for (const f of requiredHandleAliases) expect(PROTECTED_PROFILE_FIELDS).toContain(f);
  });

  it("includes every public-display-name alias the bug spec calls out", () => {
    const requiredNameAliases = ["name", "displayName", "publicName", "searchName"];
    for (const f of requiredNameAliases) expect(PROTECTED_PROFILE_FIELDS).toContain(f);
  });
});

describe("summarizeLocavaIdentityPresence (AUTH_PROFILE_MERGE_PRESERVED_LOCAVA_IDENTITY log)", () => {
  it("returns all-false when no existing doc", () => {
    expect(summarizeLocavaIdentityPresence(null)).toEqual({
      hadExistingUsername: false,
      hadExistingHandle: false,
      hadExistingDisplayName: false,
      hadExistingProfilePic: false
    });
  });

  it("flags existing handle/username/displayName/photo independently", () => {
    expect(
      summarizeLocavaIdentityPresence({
        handle: "judsonspots",
        username: "judson",
        displayName: "Judson",
        profilePic: "https://wasabi.locava.app/users/judson/profile.jpg"
      })
    ).toEqual({
      hadExistingUsername: true,
      hadExistingHandle: true,
      hadExistingDisplayName: true,
      hadExistingProfilePic: true
    });
  });

  it("flags username independently of handle when only `username` alias is stored", () => {
    expect(summarizeLocavaIdentityPresence({ username: "judson" })).toEqual({
      hadExistingUsername: true,
      hadExistingHandle: false,
      hadExistingDisplayName: false,
      hadExistingProfilePic: false
    });
  });

  it("flags handle as also implying username (handle is a strict subset of username surface)", () => {
    expect(summarizeLocavaIdentityPresence({ handle: "judsonspots" })).toEqual({
      hadExistingUsername: true,
      hadExistingHandle: true,
      hadExistingDisplayName: false,
      hadExistingProfilePic: false
    });
  });
});
