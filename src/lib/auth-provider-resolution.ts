/**
 * Safe auth UX helpers: Firebase Identity Toolkit error normalization and
 * provider labels (no tokens / passwords).
 */

export type AttemptedAuthProvider = "password" | "google" | "apple";

/** Decode JWT payload (middle segment) without verifying signature — only for non-security UX hints. */
export function decodeJwtPayloadUnverified(jwt: string | null | undefined): Record<string, unknown> | null {
  if (!jwt || typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const seg = parts[1];
  if (!seg) return null;
  const padded = seg.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tailAfterLastSlash(value: string): string {
  const idx = value.lastIndexOf("/");
  return idx >= 0 ? value.slice(idx + 1).trim() : value.trim();
}

/**
 * Firebase `accounts:signInWithIdp` returns `federatedId` (preferred) and sometimes sparse `rawUserInfo`.
 */
export function extractIdpProviderUserId(input: {
  federatedId?: string | null;
  rawUserInfo?: string | null;
  idTokenJwt?: string | null;
}): string | null {
  const fed = typeof input.federatedId === "string" ? input.federatedId.trim() : "";
  if (fed.length > 0) {
    const tail = tailAfterLastSlash(fed);
    if (tail.length > 0) return tail;
  }
  if (typeof input.rawUserInfo === "string" && input.rawUserInfo.trim().length > 0) {
    try {
      const raw = JSON.parse(input.rawUserInfo) as Record<string, unknown>;
      const sub = String(raw.sub ?? raw.user_id ?? raw.id ?? "").trim();
      if (sub.length > 0) return sub;
    } catch {
      /* ignore */
    }
  }
  const payload = decodeJwtPayloadUnverified(input.idTokenJwt ?? null);
  if (payload) {
    const sub = String(payload.sub ?? "").trim();
    if (sub.length > 0) return sub;
  }
  return null;
}

export function normalizeFirebaseToolkitCode(message: string): string {
  return String(message ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
}

export function labelForSignInMethod(method: string): string {
  switch (method) {
    case "password":
      return "email and password";
    case "google.com":
      return "Google";
    case "apple.com":
      return "Apple";
    case "phone":
      return "phone number";
    default:
      return method && method.includes(".") ? "your original sign-in method" : "your original sign-in method";
  }
}

export function buildWrongProviderHints(existingProviderIds: string[], _attemptedProvider: AttemptedAuthProvider): string {
  void _attemptedProvider;
  const labels = [...new Set(existingProviderIds.map(labelForSignInMethod))];
  if (labels.length === 1) {
    const one = labels[0]!;
    return `Looks like you used ${one} to sign up before. Please continue with ${one} using this same email.`;
  }
  if (labels.length > 1) {
    return `Looks like this email uses ${labels.join(" or ")} to sign in. Continue with the method you originally used for this email.`;
  }
  return "Sign-in could not complete. Try the sign-in method you used originally.";
}

export type PasswordLoginNormalization = {
  userMessage: string;
  /** Stable code for logs / clients — not shown to users by default */
  errorCode: string;
  /** Optional single provider slug for telemetry */
  normalizedProviderHint?: string;
};

export function normalizePasswordLoginFailure(
  firebaseErrorMessage: string,
  signInMethods: string[],
  emailExists: boolean | null = null
): PasswordLoginNormalization {
  const code = normalizeFirebaseToolkitCode(firebaseErrorMessage);
  const methods = Array.isArray(signInMethods) ? signInMethods.filter((m) => typeof m === "string") : [];

  if (code.includes("USER_DISABLED") || code.includes("DISABLED_USER")) {
    return { userMessage: "This account has been disabled. Contact support if you need help.", errorCode: "user_disabled" };
  }

  const hasPassword = methods.includes("password");
  const otherProviders = methods.filter((m) => m !== "password");

  if (hasPassword) {
    if (code.includes("INVALID_PASSWORD")) {
      return { userMessage: "Incorrect password. Please try again.", errorCode: "wrong_password", normalizedProviderHint: "password" };
    }
    if (code.includes("EMAIL_NOT_FOUND") || code.includes("USER_NOT_FOUND")) {
      return { userMessage: "No account found with this email.", errorCode: "user_not_found" };
    }
    return {
      userMessage: "Incorrect password. Please try again.",
      errorCode: "invalid_credentials_with_password_linked",
      normalizedProviderHint: "password"
    };
  }

  if (otherProviders.length > 0) {
    const primary = otherProviders[0]!;
    return {
      userMessage: buildWrongProviderHints(otherProviders, "password"),
      errorCode: "wrong_provider_hint",
      normalizedProviderHint: primary.replace(".com", "")
    };
  }

  if (code.includes("INVALID_LOGIN_CREDENTIALS")) {
    if (emailExists === false) {
      return { userMessage: "No account found with this email.", errorCode: "user_not_found" };
    }
    return {
      userMessage: "Incorrect email or password. Please try again.",
      errorCode: "invalid_credentials"
    };
  }

  if (code.includes("EMAIL_NOT_FOUND") || code.includes("USER_NOT_FOUND")) {
    return { userMessage: "No account found with this email.", errorCode: "user_not_found" };
  }

  return {
    userMessage: "Sign-in failed. Double-check your email and password.",
    errorCode: "login_failed_generic"
  };
}

export function normalizeOAuthSignInFailure(params: {
  attemptedProvider: "google" | "apple";
  firebaseErrorMessage: string;
  signInMethods: string[];
}): { userMessage: string; errorCode: string } {
  const rawTrim = String(params.firebaseErrorMessage ?? "").trim();
  if (rawTrim === "FETCH_FAILED" || rawTrim === "INVALID_JSON_RESPONSE") {
    return {
      userMessage: "Could not complete sign-in with Firebase (network or malformed Identity Toolkit response). Retry once; then verify FIREBASE_WEB_API_KEY and outbound connectivity.",
      errorCode: "firebase_credential_exchange_failed"
    };
  }

  const code = normalizeFirebaseToolkitCode(params.firebaseErrorMessage);
  const methods = Array.isArray(params.signInMethods) ? params.signInMethods.filter((m) => typeof m === "string") : [];

  if (code.includes("MISSING_GOOGLE_OAUTH_TOKEN") || params.firebaseErrorMessage.includes("MISSING_GOOGLE")) {
    return {
      userMessage: "Google sign-in did not return a usable token from this device. Try again after updating the app.",
      errorCode: "google_token_missing"
    };
  }

  if (code.includes("USER_DISABLED")) {
    return { userMessage: "This account has been disabled. Contact support if you need help.", errorCode: "user_disabled" };
  }

  const attemptedSlug = params.attemptedProvider === "google" ? "google.com" : "apple.com";
  const filtered = methods.filter((m) => m !== attemptedSlug);

  if (
    code.includes("EMAIL_EXISTS") ||
    code.includes("EXISTENT") ||
    code.includes("FEDERATED_USER_ID_ALREADY_LINKED") ||
    code.includes("ACCOUNT_EXISTS") ||
    code.includes("CREDENTIAL_IN_USE") ||
    code.includes("ALREADY_LINKED") ||
    (filtered.length > 0 && filtered.length !== methods.length)
  ) {
    if (filtered.length > 1) {
      return {
        userMessage: buildWrongProviderHints(filtered, params.attemptedProvider),
        errorCode: "wrong_provider_hint"
      };
    }
    if (filtered.length === 1 && filtered[0]) {
      return {
        userMessage: buildWrongProviderHints([filtered[0]], params.attemptedProvider),
        errorCode: "wrong_provider_hint"
      };
    }
  }

  if (code.includes("MISSING_OR_INVALID_NONCE")) {
    return {
      userMessage: "Apple sign-in could not be verified. Update the app and try again, or use another sign-in method.",
      errorCode: "apple_nonce_invalid"
    };
  }

  if (params.attemptedProvider === "apple" && (code.includes("INVALID_IDP") || code.includes("INVALID_CREDENTIAL"))) {
    return {
      userMessage: "Apple sign-in could not be completed. Try again, or verify Apple / Firebase Sign in configuration.",
      errorCode: "apple_idp_failed"
    };
  }

  if (params.attemptedProvider === "google" && (code.includes("INVALID_IDP") || code.includes("INVALID_CREDENTIAL"))) {
    return {
      userMessage: "Google sign-in could not be completed. Try again, or verify Google OAuth configuration.",
      errorCode: "google_idp_failed"
    };
  }

  return {
    userMessage: `${params.attemptedProvider === "apple" ? "Apple" : "Google"} sign-in failed. Try again in a moment.`,
    errorCode: "oauth_generic"
  };
}

export function normalizeRegisterFailure(firebaseErrorMessage: string, signInMethods: string[]): PasswordLoginNormalization {
  const code = normalizeFirebaseToolkitCode(firebaseErrorMessage);
  const methods = Array.isArray(signInMethods) ? signInMethods.filter((m) => typeof m === "string") : [];

  if (
    code.includes("EMAIL_EXISTS") ||
    code.includes("ALREADY_IN_USE") ||
    code.includes("ALREADY_EXISTS")
  ) {
    if (methods.length > 0) {
      return {
        userMessage: buildWrongProviderHints(methods, "password"),
        errorCode: "email_in_use_hint",
        normalizedProviderHint: methods[0]
      };
    }
    return {
      userMessage:
        "This email is already in use with another sign-in method. Try Google, Apple, or email/password—the one you originally used.",
      errorCode: "email_already_in_use"
    };
  }

  return { userMessage: "Could not complete sign-up. Please try again.", errorCode: "register_failed_generic" };
}
