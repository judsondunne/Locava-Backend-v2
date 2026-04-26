import { describe, expect, it } from "vitest";

import {
  collapseWhitespace,
  computeSearchFieldPatch,
  deriveExpectedSearchFields,
  mergeSearchFieldsIntoUserWritePayload,
  normalizeSearchHandleFromRaw,
  normalizeSearchNameFromRaw
} from "./user-search-fields.js";

describe("normalizeSearchHandleFromRaw", () => {
  it("preserves underscores and digits", () => {
    expect(normalizeSearchHandleFromRaw("alex_brown")).toBe("alex_brown");
    expect(normalizeSearchHandleFromRaw("User99_test")).toBe("user99_test");
  });

  it("trims and lowercases", () => {
    expect(normalizeSearchHandleFromRaw(" Alex_Brown ")).toBe("alex_brown");
  });

  it("strips leading @ symbols", () => {
    expect(normalizeSearchHandleFromRaw("@@Alex")).toBe("alex");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeSearchHandleFromRaw("  a  b\tc ")).toBe("a b c");
  });

  it("returns null when unusable", () => {
    expect(normalizeSearchHandleFromRaw(undefined)).toBe(null);
    expect(normalizeSearchHandleFromRaw("   ")).toBe(null);
    expect(normalizeSearchHandleFromRaw("\t")).toBe(null);
  });
});

describe("normalizeSearchNameFromRaw", () => {
  it("matches spec examples", () => {
    expect(normalizeSearchNameFromRaw("Alex Brown")).toBe("alex brown");
    expect(normalizeSearchNameFromRaw("  Zoë   M  ")).toBe("zoë m");
  });
});

describe("collapseWhitespace", () => {
  it("trims outer space and collapses internally", () => {
    expect(collapseWhitespace("\n foo  bar   \t")).toBe("foo bar");
  });
});

describe("computeSearchFieldPatch", () => {
  it("adds missing search fields when handle/name exist", () => {
    expect(
      computeSearchFieldPatch({
        handle: "Alex_Brown",
        name: "Alex Brown"
      })
    ).toEqual({ searchHandle: "alex_brown", searchName: "alex brown" });
  });

  it("repairs incorrect stored search fields", () => {
    expect(
      computeSearchFieldPatch({
        handle: "alex_brown",
        searchHandle: "WRONG",
        name: "Alex Brown",
        searchName: ""
      })
    ).toEqual({ searchHandle: "alex_brown", searchName: "alex brown" });
  });

  it("returns null when nothing changes", () => {
    expect(
      computeSearchFieldPatch({
        handle: "alex_brown",
        name: "Alex Brown",
        searchHandle: "alex_brown",
        searchName: "alex brown"
      })
    ).toBe(null);
  });

  it("does not invent fields when sources are absent", () => {
    expect(computeSearchFieldPatch({ handle: "ok" })).toEqual({ searchHandle: "ok" });
    expect(
      computeSearchFieldPatch({
        handle: "ok",
        searchHandle: "ok"
      })
    ).toBe(null);
    expect(
      computeSearchFieldPatch({
        searchHandle: "orphan-only"
      })
    ).toBe(null);
  });
});

describe("deriveExpectedSearchFields", () => {
  it("reports missing canonical fields", () => {
    const empty = deriveExpectedSearchFields({});
    expect(empty.missingHandle).toBe(true);
    expect(empty.missingName).toBe(true);

    const handleOnly = deriveExpectedSearchFields({ handle: "x", name: "" });
    expect(handleOnly.missingHandle).toBe(false);
    expect(handleOnly.missingName).toBe(true);
  });
});

describe("mergeSearchFieldsIntoUserWritePayload", () => {
  it("attaches derived search fields for outgoing writes", () => {
    expect(
      mergeSearchFieldsIntoUserWritePayload({
        handle: "Alex_Brown",
        name: "Alex Brown",
        bio: "x"
      })
    ).toMatchObject({
      handle: "Alex_Brown",
      name: "Alex Brown",
      bio: "x",
      searchHandle: "alex_brown",
      searchName: "alex brown"
    });
  });
});
