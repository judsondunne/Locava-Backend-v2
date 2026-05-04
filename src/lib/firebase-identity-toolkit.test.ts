import { describe, expect, it } from "vitest";
import { FirebaseAppleIdTokenExchangeError } from "./apple-firebase-backend-exchange.js";
import {
  classifyAppleIdentityToolkitMessage,
  classifyFirebaseAuthSupportingFailure,
  normalizedOriginsComparable
} from "./firebase-identity-toolkit.js";

describe("firebase identity toolkit helpers", () => {
  it("classifies FETCH_FAILED credential exchange failures", () => {
    const r = classifyAppleIdentityToolkitMessage("FETCH_FAILED");
    expect(r?.errorCode).toBe("firebase_credential_exchange_failed");
  });

  it("classifies INVALID_IDP_RESPONSE-style Apple token rejects", () => {
    const r = classifyAppleIdentityToolkitMessage("INVALID_IDP_RESPONSE");
    expect(r?.errorCode).toBe("apple_token_verify_failed");
  });

  it("classifies MISSING_OR_INVALID_NONCE as nonce verify failure", () => {
    const r = classifyAppleIdentityToolkitMessage("MISSING_OR_INVALID_NONCE");
    expect(r?.errorCode).toBe("apple_nonce_verify_failed");
  });

  it("classifies Identity Toolkit INVALID_IDP_RESPONSE audience mismatch with apple_token_audience_mismatch", () => {
    const msg =
      "INVALID_IDP_RESPONSE : The audience in ID Token [com.judsondunne.locava] does not match the expected audience com.judsondunne.locava.web.";
    const r = classifyAppleIdentityToolkitMessage(msg, {
      appleIosBundleId: "com.judsondunne.locava",
      appleWebServicesId: "com.judsondunne.locava.web"
    });
    expect(r?.errorCode).toBe("apple_token_audience_mismatch");
    expect(r?.toolkitMeta?.appleTokenAudience).toBe("com.judsondunne.locava");
    expect(r?.toolkitMeta?.firebaseExpectedAudienceToolkit).toBe("com.judsondunne.locava.web");
    expect(r?.toolkitMeta?.recommendedFix).toContain("firebase_apple_via_client_exchange");
  });

  it("treats web Services ID audiences as mismatched versus native bundle when Firebase expects bundle (symmetric)", () => {
    const msg =
      "INVALID_IDP_RESPONSE : The audience in ID Token [com.judsondunne.locava.web] does not match the expected audience com.judsondunne.locava.";
    const r = classifyAppleIdentityToolkitMessage(msg);
    expect(r?.errorCode).toBe("apple_token_audience_mismatch");
    expect(r?.toolkitMeta?.appleTokenAudience).toBe("com.judsondunne.locava.web");
  });

  it("classifies FirebaseAppleIdTokenExchangeError codes for firebase client OAuth path", () => {
    const r = classifyFirebaseAuthSupportingFailure(new FirebaseAppleIdTokenExchangeError("firebase_id_token_verify_failed", "x"));
    expect(r?.errorCode).toBe("apple_firebase_id_token_invalid");
  });

  it("classifies Firebase supporting permission failures", () => {
    const err = { code: 7, message: "7 PERMISSION_DENIED: Missing or insufficient permissions." };
    const r = classifyFirebaseAuthSupportingFailure(err);
    expect(r?.errorCode).toBe("firebase_admin_permission_failed");
  });

  it("compares normalized origins for collision checks", () => {
    expect(
      normalizedOriginsComparable("https://locava-backend-v2-nboawyiasq-uc.a.run.app/", "https://locava-backend-v2-nboawyiasq-uc.a.run.app")
    ).toBe(true);
    expect(
      normalizedOriginsComparable(
        "https://locava-backend-v2-nboawyiasq-uc.a.run.app",
        "https://locava-backend-nboawyiasq-uc.a.run.app/"
      )
    ).toBe(false);
  });
});
