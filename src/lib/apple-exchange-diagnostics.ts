import { decodeJwtPayloadUnverified } from "./auth-provider-resolution.js";

export type JwtHeaderKidAlg = {
  alg?: string;
  kid?: string;
};

/** Decode JWT header segment only (no verification) — diagnostics only */
export function decodeJwtHeaderUnverified(jwt: string | null | undefined): JwtHeaderKidAlg | null {
  if (!jwt || typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length < 1) return null;
  const seg = parts[0];
  if (!seg) return null;
  try {
    const padded = seg.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const b64 = padded + "=".repeat(padLen);
    const json = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const o = parsed as Record<string, unknown>;
    const alg = typeof o.alg === "string" ? o.alg : undefined;
    const kid = typeof o.kid === "string" ? o.kid : undefined;
    return { alg, kid };
  } catch {
    return null;
  }
}

/**
 * Parses Firebase INVALID_IDP_RESPONSE audience mismatch text.
 * Example: "The audience in ID Token [com.example.app] does not match the expected audience com.example.app.web."
 */
export function extractToolkitAppleAudienceMismatch(
  firebaseToolkitMessage: string
): { tokenAudience: string; expectedAudience: string } | null {
  const raw = firebaseToolkitMessage.trim();
  const re =
    /\[\s*([^\]\s]+)\s*\]\s*does\s*not\s*match\s*the\s*expected\s*audience\s*([\w.:-]+)/i;
  const m = raw.match(re);
  const tokenAudience = typeof m?.[1] === "string" ? m[1].trim() : "";
  let expectedAudience = typeof m?.[2] === "string" ? m[2].trim() : "";
  expectedAudience = expectedAudience.replace(/[.\s]+$/, "").trim();
  if (!tokenAudience || !expectedAudience) return null;
  return { tokenAudience, expectedAudience };
}

export function buildAppleJwtDiagnosticsUnverified(
  appleIdentityJwt: string | null | undefined
): {
  header: JwtHeaderKidAlg | null;
  appleTokenAudience?: string | null;
  appleSubject?: string | null;
  issuer?: string | null;
  hasNonceClaim: boolean;
} {
  const header = decodeJwtHeaderUnverified(appleIdentityJwt ?? null);
  const payload = decodeJwtPayloadUnverified(typeof appleIdentityJwt === "string" ? appleIdentityJwt : null);
  const aud = payload?.aud;
  let appleTokenAudience: string | null = null;
  if (typeof aud === "string" && aud.trim()) appleTokenAudience = aud.trim();
  else if (Array.isArray(aud) && aud.length > 0 && typeof aud[0] === "string") appleTokenAudience = aud[0]!.trim();
  const sub = typeof payload?.sub === "string" ? payload.sub.trim() : null;
  const iss = typeof payload?.iss === "string" ? payload.iss.trim() : null;
  const nonce = typeof payload?.nonce === "string" ? payload.nonce.trim() : "";
  return {
    header,
    appleTokenAudience,
    appleSubject: sub,
    issuer: iss,
    hasNonceClaim: nonce.length > 0
  };
}

export function audienceMismatchRecommendedFix(params: {
  tokenAudience: string;
  expectedAudience: string;
  bundleIdConfigured?: string;
  webServicesIdConfigured?: string;
}): string {
  const bundle = params.bundleIdConfigured ?? "YOUR_IOS_BUNDLE_ID";
  const svc = params.webServicesIdConfigured ?? "YOUR_APPLE_SERVICES_ID";
  if (params.tokenAudience === bundle.replace(/\s+/g, "") && params.expectedAudience.includes(".web")) {
    return (
      `Native Sign in with Apple mints an Apple JWT with aud=${params.tokenAudience} (bundle ID), but Firebase Identity Toolkit ` +
      `is validating against your Apple OAuth Services ID (${params.expectedAudience}). ` +
      `Preferred fix for iOS Locava builds: Locava-Native completes Apple locally, calls Firebase Auth signInWithCredential(OAuthProvider('apple.com')), ` +
      `then sends oauthExchangeMode=firebase_apple_via_client_exchange + firebaseIdToken to Backendv2 ` +
      `so the server verifies a Firebase session rather than exchanging the raw bundle-aud Apple token via REST. ` +
      `Console alternative (if Firebase supports OAuth client registration for bundle audience on your plan): configure Apple auth on Firebase so bundle-id audience is accepted alongside ${svc}.`
    );
  }
  return (
    `Apple JWT audience (${params.tokenAudience}) does not match Firebase's expected OAuth audience (${params.expectedAudience}). ` +
    `Align Firebase Console Apple Sign-In configuration with the token source (bundle ID vs Apple Services ID) or switch the client to firebase_apple_via_client_exchange + firebaseIdToken.`
  );
}
