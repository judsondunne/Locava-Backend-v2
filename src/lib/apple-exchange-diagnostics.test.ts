import { describe, expect, it } from "vitest";
import {
  extractToolkitAppleAudienceMismatch,
  buildAppleJwtDiagnosticsUnverified
} from "./apple-exchange-diagnostics.js";

describe("apple exchange diagnostics", () => {
  it("parses toolkit audience mismatch messages and trims trailing punctuation on expected audience", () => {
    const msg =
      'INVALID_IDP_RESPONSE : The audience in ID Token [com.judsondunne.locava] does not match the expected audience com.judsondunne.locava.web.';
    expect(extractToolkitAppleAudienceMismatch(msg)).toEqual({
      tokenAudience: "com.judsondunne.locava",
      expectedAudience: "com.judsondunne.locava.web"
    });
  });

  it("decode native Apple JWT aud for diagnostics without verification", () => {
    const h = Buffer.from(JSON.stringify({ alg: "ES256", kid: "k1" }), "utf8").toString("base64url");
    const p = Buffer.from(JSON.stringify({ aud: "com.judsondunne.locava", nonce: "n1", sub: "s" }), "utf8").toString(
      "base64url"
    );
    const jwt = `${h}.${p}.stub`;
    const d = buildAppleJwtDiagnosticsUnverified(jwt);
    expect(d.appleTokenAudience).toBe("com.judsondunne.locava");
    expect(d.hasNonceClaim).toBe(true);
    expect(d.header?.kid).toBe("k1");
  });

  it("decode web-token style aud=com.judsondunne.locava.web", () => {
    const h = Buffer.from(JSON.stringify({ alg: "none" }), "utf8").toString("base64url");
    const p = Buffer.from(JSON.stringify({ aud: "com.judsondunne.locava.web", sub: "s" }), "utf8").toString(
      "base64url"
    );
    expect(buildAppleJwtDiagnosticsUnverified(`${h}.${p}.x`).appleTokenAudience).toBe("com.judsondunne.locava.web");
    expect(buildAppleJwtDiagnosticsUnverified(`${h}.${p}.x`).hasNonceClaim).toBe(false);
  });
});
