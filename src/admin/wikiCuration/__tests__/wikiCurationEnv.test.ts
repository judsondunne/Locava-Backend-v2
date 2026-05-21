import { afterEach, describe, expect, it } from "vitest";
import { wikiSpotCurationGeminiApiKey, wikiSpotCurationGeminiApiKeyMeta } from "../wikiCurationEnv.js";

describe("wikiSpotCurationGeminiApiKeyMeta", () => {
  const origG = process.env.GEMINI_API_KEY;
  const origGg = process.env.GOOGLE_GEMINI_API_KEY;

  afterEach(() => {
    if (origG === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = origG;
    if (origGg === undefined) delete process.env.GOOGLE_GEMINI_API_KEY;
    else process.env.GOOGLE_GEMINI_API_KEY = origGg;
  });

  it("prefers GEMINI_API_KEY when both are set", () => {
    process.env.GEMINI_API_KEY = "aaa";
    process.env.GOOGLE_GEMINI_API_KEY = "bbbb";
    expect(wikiSpotCurationGeminiApiKeyMeta()).toEqual({
      configured: true,
      source: "GEMINI_API_KEY",
      keyLength: 3,
      bothGeminiVarsSet: true
    });
    expect(wikiSpotCurationGeminiApiKey()).toBe("aaa");
  });

  it("falls back to GOOGLE_GEMINI_API_KEY when GEMINI is unset", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_GEMINI_API_KEY = "xy";
    expect(wikiSpotCurationGeminiApiKeyMeta()).toEqual({
      configured: true,
      source: "GOOGLE_GEMINI_API_KEY",
      keyLength: 2,
      bothGeminiVarsSet: false
    });
    expect(wikiSpotCurationGeminiApiKey()).toBe("xy");
  });
});
