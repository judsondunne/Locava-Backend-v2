import type { Auth, UserRecord } from "firebase-admin/auth";

export class FirebaseAppleIdTokenExchangeError extends Error {
  readonly name = "FirebaseAppleIdTokenExchangeError";
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.code = code;
  }
}

/**
 * After native Firebase Auth `OAuthProvider('apple.com').credential({ idToken, rawNonce })` + signInWithCredential,
 * verifies the Firebase session ID token and extracts the Apple federation subject for Locava resolution logic.
 */
export async function resolveAppleSignInViaFirebaseSessionIdToken(
  adminAuth: Auth,
  firebaseIdToken: string
): Promise<{ firebaseUid: string; appleProviderUid: string; email: string | null; displayName: string | null }> {
  let decoded: Record<string, unknown>;
  try {
    decoded = (await adminAuth.verifyIdToken(firebaseIdToken, false)) as unknown as Record<string, unknown>;
  } catch (e) {
    throw new FirebaseAppleIdTokenExchangeError(
      "firebase_id_token_verify_failed",
      `Firebase Admin could not verify the client-sent ID token (${e instanceof Error ? e.message : String(e)})`
    );
  }

  const firebaseObj = decoded.firebase && typeof decoded.firebase === "object" ? (decoded.firebase as Record<string, unknown>) : null;
  const signInProvider = typeof firebaseObj?.sign_in_provider === "string" ? firebaseObj.sign_in_provider.trim() : "";
  if (signInProvider !== "apple.com") {
    throw new FirebaseAppleIdTokenExchangeError(
      "firebase_id_token_provider_not_apple",
      `Expected Firebase session from Apple (sign_in_provider=apple.com); got "${signInProvider || "missing"}"`
    );
  }

  const firebaseUid = typeof decoded.uid === "string" && decoded.uid.trim() ? decoded.uid.trim() : "";
  if (!firebaseUid) {
    throw new FirebaseAppleIdTokenExchangeError("firebase_id_token_missing_uid", "Decoded Firebase token missing uid");
  }

  let rec: UserRecord;
  try {
    rec = await adminAuth.getUser(firebaseUid);
  } catch (e) {
    throw new FirebaseAppleIdTokenExchangeError(
      "firebase_user_lookup_failed",
      `Firebase user missing after verified token (${e instanceof Error ? e.message : String(e)})`
    );
  }

  const appleLink = rec.providerData.find((p) => p.providerId === "apple.com");
  const appleProviderUid =
    appleLink?.uid != null && String(appleLink.uid).trim().length > 0 ? String(appleLink.uid).trim() : "";

  if (!appleProviderUid) {
    throw new FirebaseAppleIdTokenExchangeError(
      "firebase_user_missing_apple_provider",
      "Firebase user record has no apple.com federated UID (provider linkage missing)"
    );
  }

  const emailFromToken =
    typeof decoded.email === "string" && decoded.email.includes("@") ? decoded.email.trim().toLowerCase() : null;
  const emailFromUser =
    typeof rec.email === "string" && rec.email.includes("@") ? rec.email.trim().toLowerCase() : null;

  const displayName = typeof rec.displayName === "string" && rec.displayName.trim() ? rec.displayName.trim() : null;

  return {
    firebaseUid,
    appleProviderUid,
    email: emailFromToken ?? emailFromUser,
    displayName
  };
}
