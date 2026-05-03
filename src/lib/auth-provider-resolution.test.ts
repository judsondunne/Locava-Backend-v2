import { describe, expect, it } from "vitest";
import {
  decodeJwtPayloadUnverified,
  extractIdpProviderUserId,
  normalizeOAuthSignInFailure,
  normalizePasswordLoginFailure,
  normalizeRegisterFailure,
} from "./auth-provider-resolution.js";

describe("auth-provider-resolution", () => {
  it("extracts federatedId tail for Google-style URLs", () => {
    const uid = extractIdpProviderUserId({
      federatedId: "https://accounts.google.com/12345",
      rawUserInfo: null,
      idTokenJwt: null
    });
    expect(uid).toBe("12345");
  });

  it("falls back to rawUserInfo.sub", () => {
    const uid = extractIdpProviderUserId({
      federatedId: "",
      rawUserInfo: JSON.stringify({ sub: "apple-sub-1" }),
      idTokenJwt: null
    });
    expect(uid).toBe("apple-sub-1");
  });

  it("decodes JWT payload for sub when needed", () => {
    const payload = { sub: "from-jwt", email: "user@example.com" };
    const b64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const jwt = `x.${b64}.y`;
    const uid = extractIdpProviderUserId({ federatedId: "", rawUserInfo: "{}", idTokenJwt: jwt });
    expect(uid).toBe("from-jwt");
    expect(decodeJwtPayloadUnverified(jwt)?.email).toBe("user@example.com");
  });

  it("password login: wrong provider when no password method but google present", () => {
    const r = normalizePasswordLoginFailure("INVALID_LOGIN_CREDENTIALS", ["google.com"]);
    expect(r.userMessage).toContain("Google");
    expect(r.errorCode).toBe("wrong_provider_hint");
  });

  it("password login: wrong password when password linked", () => {
    const r = normalizePasswordLoginFailure("INVALID_LOGIN_CREDENTIALS", ["password"]);
    expect(r.userMessage).toContain("Incorrect password");
  });

  it("password login: invalid credentials with unknown email maps to user_not_found when exists=false", () => {
    const r = normalizePasswordLoginFailure("INVALID_LOGIN_CREDENTIALS", [], false);
    expect(r.errorCode).toBe("user_not_found");
  });

  it("register: EMAIL_EXISTS maps to hint", () => {
    const r = normalizeRegisterFailure("EMAIL_EXISTS", ["google.com"]);
    expect(r.userMessage).toContain("Google");
  });

  it("oauth google: maps account exists to Apple hint", () => {
    const r = normalizeOAuthSignInFailure({
      attemptedProvider: "google",
      firebaseErrorMessage: "FEDERATED_USER_ID_ALREADY_LINKED",
      signInMethods: ["apple.com"]
    });
    expect(r.userMessage).toContain("Apple");
  });

  it("oauth google: missing tokens uses dedicated copy", () => {
    const r = normalizeOAuthSignInFailure({
      attemptedProvider: "google",
      firebaseErrorMessage: "MISSING_GOOGLE_OAUTH_TOKEN",
      signInMethods: []
    });
    expect(r.errorCode).toBe("google_token_missing");
    expect(r.userMessage).toContain("Google");
  });
});
