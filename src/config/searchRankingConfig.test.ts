import { afterEach, describe, expect, it } from "vitest";
import { getSearchRankingVersion, isSemanticRankingEnabled } from "./searchRankingConfig.js";

const original = process.env.SEARCH_RANKING_VERSION;
afterEach(() => {
  if (original === undefined) delete process.env.SEARCH_RANKING_VERSION;
  else process.env.SEARCH_RANKING_VERSION = original;
});

describe("searchRankingConfig", () => {
  it("defaults to lexical_v1 when unset", () => {
    delete process.env.SEARCH_RANKING_VERSION;
    expect(getSearchRankingVersion()).toBe("lexical_v1");
    expect(isSemanticRankingEnabled()).toBe(false);
  });

  it("selects semantic_v1 only for the exact opt-in value", () => {
    process.env.SEARCH_RANKING_VERSION = "semantic_v1";
    expect(getSearchRankingVersion()).toBe("semantic_v1");
    expect(isSemanticRankingEnabled()).toBe(true);
  });

  it("treats unknown values as lexical_v1", () => {
    process.env.SEARCH_RANKING_VERSION = "experimental";
    expect(getSearchRankingVersion()).toBe("lexical_v1");
  });
});
