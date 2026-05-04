import { createHash, timingSafeEqual } from "node:crypto";

import * as jose from "jose";

/**
 * Mirrors legacy Express `appleSignIn` behavior: verifies Apple JWT with Apple's JWKS locally.
 * Bypasses Firebase Identity Toolkit `signInWithIdp` (which rejects native bundle-ID audience when Firebase Apple OAuth pins Services ID).
 */

export type AppleJwtVerifiedClaims = {
  sub: string;
  /** May be absent on repeat sign-ins ("Hide My Email") */
  email: string | null;
  emailVerified: boolean | null;
};

export class AppleNativeJwtVerifyError extends Error {
  readonly name = "AppleNativeJwtVerifyError";
  readonly code:
    | "apple_jwt_invalid"
    | "apple_jwt_nonce_mismatch"
    | "apple_jwt_audience_invalid"
    | "apple_jwt_expired_or_invalid_signature";

  constructor(code: AppleNativeJwtVerifyError["code"], message: string, cause?: unknown) {
    super(message, { cause });
    this.code = code;
  }
}

const APPLE_JWKS = jose.createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const APPLE_ISSUER = "https://appleid.apple.com";

function sha256HexLower(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function timingSafeHexEqual(expectedLowerHex: string, actualLowerHex: string): boolean {
  try {
    if (typeof expectedLowerHex !== "string" || typeof actualLowerHex !== "string") return false;
    if (expectedLowerHex.length % 2 !== 0 || actualLowerHex.length % 2 !== 0) return false;
    const ab = Buffer.from(expectedLowerHex, "hex");
    const bb = Buffer.from(actualLowerHex, "hex");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * Validates native iOS identity token (`aud`=bundle ID) using Apple JWKS.
 * Optionally verifies nonce hash when JWT contains `nonce` (Sign in with Apple + Expo SHA256 HEX flow).
 */
export async function verifyAppleNativeIdentityJwt(
  identityJwt: string,
  input: {
    expectedAudienceBundleId: string;
    rawNonce?: string | null;
  }
): Promise<AppleJwtVerifiedClaims> {
  const trimmed = identityJwt.trim();
  if (!trimmed) throw new AppleNativeJwtVerifyError("apple_jwt_invalid", "missing_apple_identity_token");

  const aud = input.expectedAudienceBundleId.trim();
  if (!aud) throw new AppleNativeJwtVerifyError("apple_jwt_invalid", "server_missing_expected_apple_audience_bundle_id");

  let payload: jose.JWTPayload;
  try {
    const res = await jose.jwtVerify(trimmed, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience: aud
    });
    payload = res.payload;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/expired|expiration|jwt expired/i.test(msg)) {
      throw new AppleNativeJwtVerifyError("apple_jwt_expired_or_invalid_signature", `apple_jwt_verify_failed:${msg}`, e);
    }
    if (/audience|audienc/i.test(msg)) {
      throw new AppleNativeJwtVerifyError("apple_jwt_audience_invalid", `apple_jwt_audience_rejected:${msg}`, e);
    }
    throw new AppleNativeJwtVerifyError("apple_jwt_expired_or_invalid_signature", `apple_jwt_verify_failed:${msg}`, e);
  }

  const sub = typeof payload.sub === "string" && payload.sub.trim() ? payload.sub.trim() : "";
  if (!sub) throw new AppleNativeJwtVerifyError("apple_jwt_invalid", "apple_jwt_missing_subject");

  const nonceClaimRaw =
    typeof payload.nonce === "string" && payload.nonce.trim().length > 0 ? payload.nonce.trim() : "";

  const rawNonce = typeof input.rawNonce === "string" ? input.rawNonce.trim() : "";
  if (nonceClaimRaw) {
    if (rawNonce.length < 8) {
      throw new AppleNativeJwtVerifyError(
        "apple_jwt_nonce_mismatch",
        "apple_identity_token_contains_nonce_but_raw_nonce_missing_or_short"
      );
    }
    let hexFromClaim = nonceClaimRaw.replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "").toLowerCase();
    /** Some stacks emit base64 for Apple nonce hashes; HEX is the Expo+iOS SHA256 expectation (64 chars). */
    if (hexFromClaim.length !== 64) {
      throw new AppleNativeJwtVerifyError(
        "apple_jwt_nonce_mismatch",
        `apple_jwt_nonce_unexpected_encoding_length_${hexFromClaim.length}_expected_64_sha256_hex`
      );
    }
    const expectedHash = sha256HexLower(rawNonce).toLowerCase();
    if (!timingSafeHexEqual(expectedHash, hexFromClaim)) {
      throw new AppleNativeJwtVerifyError(
        "apple_jwt_nonce_mismatch",
        "apple_nonce_hash_in_token_does_not_match_raw_nonce_sha256_hex"
      );
    }
  }

  const email = typeof payload.email === "string" && payload.email.includes("@") ? payload.email.trim().toLowerCase() : null;

  let emailVerified: boolean | null = null;
  if (payload.email_verified === true || payload.email_verified === "true") emailVerified = true;
  else if (payload.email_verified === false || payload.email_verified === "false") emailVerified = false;

  return { sub: sub.trim(), email, emailVerified };
}
