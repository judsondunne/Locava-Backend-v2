import { describe, expect, it } from "vitest";
import {
  buildCanonicalNewUserDocument,
  normalizeActivityProfile,
  normalizeCanonicalUserDocument,
} from "./canonical-user-document.js";

describe("canonical user document", () => {
  it("normalizes selected activity labels into canonical weighted map", () => {
    const profile = normalizeActivityProfile(["Star-Gazing", "Swimming Hole", "Off Roading", "hiking"]);
    expect(profile).toEqual({
      stargazing: 4,
      swimminghole: 4,
      offroading: 4,
      hiking: 4,
    });
  });

  it("builds new user docs with object activityProfile", () => {
    const doc = buildCanonicalNewUserDocument({
      uid: "u1",
      email: "test@example.com",
      name: "Tester",
      handle: "tester",
      selectedActivities: ["hiking"],
    });
    expect(Array.isArray(doc.activityProfile)).toBe(false);
    expect(doc.activityProfile).toEqual({ hiking: 4 });
    expect(doc.searchHandle).toBe("tester");
    expect(doc.searchName).toBe("tester");
  });

  it("normalizes legacy array user docs on read", () => {
    const doc = normalizeCanonicalUserDocument({
      uid: "u2",
      handle: "legacy",
      name: "Legacy User",
      activityProfile: ["Diving", "Abandoned"],
    });
    expect(doc.activityProfile).toEqual({ diving: 4, abandoned: 4 });
  });
});
