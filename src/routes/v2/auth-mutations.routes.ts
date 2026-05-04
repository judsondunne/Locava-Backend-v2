import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AuthLoginBodySchema,
  authLoginContract
} from "../../contracts/surfaces/auth-login.contract.js";
import {
  AuthProfileBranchMergeBodySchema,
  authProfileBranchMergeContract
} from "../../contracts/surfaces/auth-profile-branch-merge.contract.js";
import {
  AuthProfileCreateBodySchema,
  authProfileCreateContract
} from "../../contracts/surfaces/auth-profile-create.contract.js";
import {
  AuthRegisterBodySchema,
  authRegisterContract
} from "../../contracts/surfaces/auth-register.contract.js";
import {
  AuthSigninAppleBodySchema,
  authSigninAppleContract
} from "../../contracts/surfaces/auth-signin-apple.contract.js";
import {
  AuthSigninGoogleBodySchema,
  authSigninGoogleContract
} from "../../contracts/surfaces/auth-signin-google.contract.js";
import { AuthSignoutBodySchema, authSignoutContract } from "../../contracts/surfaces/auth-signout.contract.js";
import { AuthDeleteAccountBodySchema, authDeleteAccountContract } from "../../contracts/surfaces/auth-delete-account.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { canUseV2Surface } from "../../flags/cutover.js";
import { getFirebaseAuthClient } from "../../repositories/source-of-truth/firebase-auth.client.js";
import { getFirebaseAdminDiagnostics } from "../../lib/firebase-admin.js";
import {
  AuthMutationsService,
  type CanonicalViewerHydration,
  type OauthAccountStatus
} from "../../services/mutations/auth-mutations.service.js";
import { primeAuthSessionCacheFromSignin } from "../../orchestration/surfaces/auth-session.orchestrator.js";
import {
  decodeJwtPayloadUnverified,
  extractIdpProviderUserId,
  normalizeOAuthSignInFailure,
  normalizePasswordLoginFailure,
  normalizeRegisterFailure
} from "../../lib/auth-provider-resolution.js";
import { buildAppleJwtDiagnosticsUnverified } from "../../lib/apple-exchange-diagnostics.js";
import {
  FirebaseAppleIdTokenExchangeError,
  resolveAppleSignInViaFirebaseSessionIdToken
} from "../../lib/apple-firebase-backend-exchange.js";
import { verifyAppleNativeIdentityJwt } from "../../lib/apple-native-jwt-verify.js";
import {
  type AppleToolkitClassifyContext,
  IdentityToolkitExchangeError,
  classifyFirebaseAuthSupportingFailure,
  resolveAppleToolkitFailureMessaging,
  resolveFirebaseToolkitContinueUri
} from "../../lib/firebase-identity-toolkit.js";

const CheckHandleQuery = z.object({
  handle: z.string().trim().min(1).max(40)
});
const CheckExistsQuery = z.object({
  email: z.string().trim().email()
});

function toNativeDestinationRoute(accountStatus: OauthAccountStatus): "app" | "onboarding_existing" | "onboarding_new" {
  switch (accountStatus) {
    case "existing_complete":
      return "app";
    case "existing_incomplete":
      return "onboarding_existing";
    case "new_account_required":
      return "onboarding_new";
  }
}

function logOauthDecision(
  log: FastifyInstance["log"],
  input: {
    routeName: string;
    authProvider: "google" | "apple";
    providerUid?: string | null;
    email?: string | null;
    matchedExistingLocavaUser: boolean;
    accountStatus: OauthAccountStatus;
    userDocumentCreated: boolean;
  }
): void {
  log.info({
    routeName: input.routeName,
    authProvider: input.authProvider,
    providerUidPresent: Boolean(input.providerUid && input.providerUid.trim().length > 0),
    emailPresent: Boolean(input.email && input.email.trim().length > 0),
    matchedExistingLocavaUser: input.matchedExistingLocavaUser,
    accountStatus: input.accountStatus,
    userDocumentCreated: input.userDocumentCreated,
    nativeDestinationRoute: toNativeDestinationRoute(input.accountStatus)
  }, "oauth_account_resolution");
}

async function signInWithPassword(email: string, password: string): Promise<{ uid: string; email: string; displayName?: string }> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error("firebase_web_api_key_missing");
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    }
  );
  const json = (await res.json()) as {
    localId?: string;
    email?: string;
    displayName?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.localId) {
    throw new Error(json.error?.message ?? "invalid_credentials");
  }
  return { uid: json.localId, email: json.email ?? email, displayName: json.displayName };
}

async function signUpWithPassword(email: string, password: string): Promise<{ uid: string; email: string; displayName?: string }> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("firebase_web_api_key_missing");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    }
  );
  const json = (await res.json()) as {
    localId?: string;
    email?: string;
    displayName?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.localId) {
    throw new Error(json.error?.message ?? "register_failed");
  }
  return { uid: json.localId, email: json.email ?? email, displayName: json.displayName };
}

async function checkUserExistsByEmail(
  email: string,
  continueUri: string
): Promise<{ exists: boolean; signInMethods: string[] }> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("firebase_web_api_key_missing");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: email,
        continueUri
      })
    }
  );
  const json = (await res.json()) as {
    registered?: boolean;
    signinMethods?: string[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? "check_user_exists_failed");
  }
  return {
    exists: json.registered === true,
    signInMethods: Array.isArray(json.signinMethods) ? json.signinMethods : []
  };
}

async function checkUserExistsWithFallbacks(
  authMutationsService: AuthMutationsService,
  email: string,
  continueUri: string
): Promise<{ exists: boolean; signInMethods: string[] }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { exists: false, signInMethods: [] };
  const direct = await checkUserExistsByEmail(normalizedEmail, continueUri).catch(() => ({ exists: false, signInMethods: [] }));
  const adminMethods = await authMutationsService.authSignInMethodsByEmail(normalizedEmail);
  const [userDocExists, authUserExists] = await Promise.all([
    authMutationsService.userDocExistsByEmail(normalizedEmail),
    authMutationsService.authUserExistsByEmail(normalizedEmail)
  ]);
  return {
    exists: direct.exists || userDocExists || authUserExists || adminMethods.length > 0,
    signInMethods: [...new Set([...(direct.signInMethods ?? []), ...adminMethods])]
  };
}

async function signInWithIdp(
  params: {
    provider: "google.com" | "apple.com";
    accessToken?: string;
    idToken?: string;
    /** Raw (unhashed) nonce for Apple — must match the value hashed into the Apple authorization request */
    appleRawNonce?: string;
  },
  toolkit: { continueUri: string }
): Promise<{ uid: string; providerId: string; email: string | null; displayName?: string; isNewUser: boolean | null }> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("firebase_web_api_key_missing");
  const postBodyBits: string[] = [`providerId=${params.provider}`];
  if (params.idToken) postBodyBits.push(`id_token=${encodeURIComponent(params.idToken)}`);
  if (params.accessToken) postBodyBits.push(`access_token=${encodeURIComponent(params.accessToken)}`);
  if (params.provider === "apple.com") {
    const rawNonce =
      typeof params.appleRawNonce === "string" && params.appleRawNonce.trim().length > 0 ? params.appleRawNonce.trim() : "";
    if (rawNonce.length > 0) {
      postBodyBits.push(`nonce=${encodeURIComponent(rawNonce)}`);
    }
  }

  let res: Response;
  try {
    res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestUri: toolkit.continueUri,
        returnSecureToken: true,
        returnIdpCredential: true,
        postBody: postBodyBits.join("&")
      })
    });
  } catch (cause) {
    throw new IdentityToolkitExchangeError("FETCH_FAILED", undefined, cause);
  }

  let json: {
    localId?: string;
    federatedId?: string;
    isNewUser?: boolean;
    email?: string;
    displayName?: string;
    rawUserInfo?: string;
    error?: { message?: string };
  };

  try {
    json = (await res.json()) as typeof json;
  } catch (cause) {
    throw new IdentityToolkitExchangeError("INVALID_JSON_RESPONSE", res.status, cause);
  }

  if (!res.ok) {
    throw new IdentityToolkitExchangeError(json.error?.message ?? "UNKNOWN_TOOLKIT_FAILURE", res.status);
  }

  let raw: Record<string, unknown> = {};
  try {
    raw = json.rawUserInfo ? (JSON.parse(json.rawUserInfo) as Record<string, unknown>) : {};
  } catch {
    raw = {};
  }

  const providerId = extractIdpProviderUserId({
    federatedId: json.federatedId,
    rawUserInfo: json.rawUserInfo,
    idTokenJwt: params.idToken
  })?.trim() ?? "";

  if (!providerId) throw new Error("provider_id_missing");
  const uid = String(json.localId ?? "").trim();
  if (!uid) throw new Error("firebase_uid_missing");
  const rawEmail = String(json.email ?? raw.email ?? "").trim();
  const email = rawEmail.length > 0 ? rawEmail.toLowerCase() : null;
  const fallbackDisplayName = String(raw.name ?? "").trim();
  return {
    uid,
    providerId,
    email,
    displayName: json.displayName ?? (fallbackDisplayName || undefined),
    isNewUser: typeof json.isNewUser === "boolean" ? json.isNewUser : null
  };
}

async function createCustomToken(uid: string): Promise<string> {
  const auth = getFirebaseAuthClient();
  if (!auth) throw new Error("firebase_auth_unavailable");
  try {
    return await auth.createCustomToken(uid);
  } catch (error) {
    const diag = getFirebaseAdminDiagnostics();
    console.error({
      event: "firebase_custom_token_create_failure",
      uid,
      projectId: diag.projectId,
      credentialSource: diag.credentialSource,
      clientEmail: diag.clientEmail,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function logAuthIdCanonicalization(
  log: FastifyInstance["log"],
  input: {
    routeName: string;
    viewerId: string;
    canonicalUserId: string;
    providerUid?: string | null;
    source: string;
    userDocFound: boolean;
  }
): void {
  log.info({
    event: "AUTH_ID_CANONICALIZATION",
    routeName: input.routeName,
    viewerId: input.viewerId,
    canonicalUserId: input.canonicalUserId,
    providerUid: input.providerUid ?? null,
    providerUidPresent: Boolean(input.providerUid),
    source: input.source,
    userDocFound: input.userDocFound
  }, "auth_id_canonicalization");
}

function logAuthLoginViewerHydration(
  log: FastifyInstance["log"],
  input: {
    routeName: string;
    viewerId: string;
    canonicalUserId: string;
    providerUid?: string | null;
    hydration: CanonicalViewerHydration;
    source: string;
  }
): void {
  log.info({
    event: "AUTH_LOGIN_VIEWER_HYDRATION",
    routeName: input.routeName,
    viewerId: input.viewerId,
    canonicalUserId: input.canonicalUserId,
    providerUid: input.providerUid ?? null,
    providerUidPresent: Boolean(input.providerUid),
    userDocFound: input.hydration.userDocFound,
    viewerSummaryPresent: input.hydration.viewerReady,
    profilePicPresent: Boolean(input.hydration.profilePic),
    handlePresent: Boolean(input.hydration.handle),
    emailPresent: Boolean(input.hydration.email),
    source: input.source,
    cacheHit: false,
    cacheMiss: true
  }, "auth_login_viewer_hydration");
}

function toSessionViewerSummary(hydration: CanonicalViewerHydration) {
  return {
    uid: hydration.uid,
    canonicalUserId: hydration.canonicalUserId,
    viewerReady: hydration.viewerReady,
    profileHydrationStatus: hydration.profileHydrationStatus,
    email: hydration.email,
    handle: hydration.handle ?? "",
    name: hydration.name,
    profilePic: hydration.profilePic,
    profilePicSmallPath: hydration.profilePicSmallPath,
    profilePicMediumPath: hydration.profilePicMediumPath,
    profilePicLargePath: hydration.profilePicLargePath,
    badge: "standard",
    onboardingComplete: hydration.onboardingComplete
  };
}

function buildAppReadyAuthResponse(input: {
  routeName: string;
  source: "login" | "google" | "apple" | "register" | "profile_create";
  token?: string;
  user: { uid: string; email?: string | null; displayName?: string | null };
  viewer?: CanonicalViewerHydration | null;
  isNewUser: boolean;
  accountStatus: OauthAccountStatus;
  profileCreated?: boolean;
  extra?: Record<string, unknown>;
}) {
  const nativeDestinationRoute = toNativeDestinationRoute(input.accountStatus);
  const viewerReady = input.viewer?.viewerReady === true;
  const onboardingComplete = input.viewer?.onboardingComplete ?? (input.accountStatus === "existing_complete");
  const profileComplete = input.viewer?.profileComplete ?? (input.accountStatus === "existing_complete");
  return success({
    routeName: input.routeName,
    success: true,
    source: input.source,
    isNewUser: input.isNewUser,
    accountStatus: input.accountStatus,
    onboardingRequired: input.accountStatus !== "existing_complete",
    nativeDestinationRoute,
    requiresProfile: input.accountStatus !== "existing_complete",
    profileCreated: input.profileCreated ?? false,
    appReady: input.accountStatus === "existing_complete" && viewerReady,
    viewerReady,
    profileHydrationStatus: input.viewer?.profileHydrationStatus ?? "minimal_fallback",
    onboardingComplete,
    profileComplete,
    canonicalUserId: input.viewer?.canonicalUserId ?? input.user.uid,
    token: input.token,
    user: {
      uid: input.user.uid,
      ...(input.user.email ? { email: input.user.email } : {}),
      ...(input.user.displayName ? { displayName: input.user.displayName } : {})
    },
    ...(input.viewer ? { viewer: input.viewer } : {}),
    ...(input.extra ?? {})
  });
}

function collectAppReadyContractViolations(input: {
  accountStatus: OauthAccountStatus;
  hydration: CanonicalViewerHydration;
}): string[] {
  const failures: string[] = [];
  const { hydration } = input;
  if (hydration.viewerReady !== true) failures.push("viewer_not_ready");
  if (hydration.profileHydrationStatus !== "ready") failures.push("profile_hydration_not_ready");
  if (!hydration.userDocFound) failures.push("user_doc_missing");
  if (!hydration.canonicalUserId || hydration.canonicalUserId.trim().length === 0) failures.push("canonical_user_id_missing");
  if (!hydration.handle || hydration.handle.trim().length === 0) failures.push("handle_missing");
  if (!hydration.name || hydration.name.trim().length === 0) failures.push("name_missing");
  if (!hydration.profilePic || hydration.profilePic.trim().length === 0) failures.push("profile_pic_missing");
  if (input.accountStatus === "existing_complete") {
    if (hydration.onboardingComplete !== true) failures.push("onboarding_complete_false");
    if (hydration.profileComplete !== true) failures.push("profile_complete_false");
  }
  return failures;
}

function rejectAuthWhenNotAppReady(params: {
  routeName: string;
  source: "email_password" | "google_existing" | "apple_existing";
  log: FastifyInstance["log"];
  accountStatus: OauthAccountStatus;
  hydration: CanonicalViewerHydration;
}): { rejected: false } | { rejected: true; response: Record<string, unknown> } {
  const failures = collectAppReadyContractViolations({
    accountStatus: params.accountStatus,
    hydration: params.hydration
  });
  if (failures.length === 0) return { rejected: false };
  params.log.error({
    event: "AUTH_SIGNIN_REJECTED_NOT_FULLY_READY",
    routeName: params.routeName,
    source: params.source,
    accountStatus: params.accountStatus,
    viewerId: params.hydration.uid,
    canonicalUserId: params.hydration.canonicalUserId,
    failures
  }, "auth_signin_rejected_not_fully_ready");
  return {
    rejected: true,
    response: success({
      routeName: params.routeName,
      success: false,
      error: "signin_not_fully_ready",
      reason: "viewer_contract_incomplete",
      failures,
      viewerReady: params.hydration.viewerReady,
      profileHydrationStatus: params.hydration.profileHydrationStatus,
      accountStatus: params.accountStatus,
      canonicalUserId: params.hydration.canonicalUserId
    })
  };
}

function logAuthAcceptedFullyReady(params: {
  routeName: string;
  source: "email_password" | "google_existing" | "apple_existing";
  log: FastifyInstance["log"];
  accountStatus: OauthAccountStatus;
  hydration: CanonicalViewerHydration;
}): void {
  params.log.info({
    event: "AUTH_SIGNIN_ACCEPTED_FULLY_READY",
    routeName: params.routeName,
    source: params.source,
    accountStatus: params.accountStatus,
    viewerId: params.hydration.uid,
    canonicalUserId: params.hydration.canonicalUserId,
    viewerReady: params.hydration.viewerReady,
    profileHydrationStatus: params.hydration.profileHydrationStatus,
    userDocFound: params.hydration.userDocFound,
    onboardingComplete: params.hydration.onboardingComplete,
    profileComplete: params.hydration.profileComplete,
    handlePresent: Boolean(params.hydration.handle),
    namePresent: Boolean(params.hydration.name),
    profilePicPresent: Boolean(params.hydration.profilePic),
    emailPresent: Boolean(params.hydration.email)
  }, "auth_signin_accepted_fully_ready");
}

async function buildOauthSuccessResponse(params: {
  routeName: string;
  authProvider: "google" | "apple";
  providerId: string;
  email: string | null;
  displayName?: string;
  resolvedUid: string;
  accountStatus: OauthAccountStatus;
  branchData?: Record<string, unknown> | null;
  authMutationsService: AuthMutationsService;
  log: FastifyInstance["log"];
  matchedExistingLocavaUser: boolean;
}): Promise<Record<string, unknown>> {
  const nativeDestinationRoute = toNativeDestinationRoute(params.accountStatus);
  const onboardingRequired = params.accountStatus !== "existing_complete";

  logOauthDecision(params.log, {
    routeName: params.routeName,
    authProvider: params.authProvider,
    providerUid: params.providerId,
    email: params.email,
    matchedExistingLocavaUser: params.matchedExistingLocavaUser,
    accountStatus: params.accountStatus,
    userDocumentCreated: false
  });

  if (
    params.matchedExistingLocavaUser &&
    params.branchData &&
    typeof params.branchData === "object" &&
    Object.keys(params.branchData).length > 0
  ) {
    await params.authMutationsService.mergeProfileBranch({
      viewerId: params.resolvedUid,
      branchData: params.branchData
    }).catch(() => undefined);
  }

  if (params.accountStatus === "new_account_required") {
    return success({
      routeName: params.routeName,
      success: true,
      isNewUser: true,
      accountStatus: params.accountStatus,
      onboardingRequired,
      nativeDestinationRoute,
      user: {
        uid: params.resolvedUid,
        ...(params.email ? { email: params.email } : {}),
        displayName: params.displayName
      },
      oauthInfo: {
        provider: params.authProvider,
        providerId: params.providerId,
        ...(params.email ? { email: params.email } : {}),
        displayName: params.displayName
      }
    });
  }

  const hydratedViewer = await params.authMutationsService.getCanonicalViewerHydration(params.resolvedUid);
  const strictReady = rejectAuthWhenNotAppReady({
    routeName: params.routeName,
    source: params.authProvider === "google" ? "google_existing" : "apple_existing",
    log: params.log,
    accountStatus: params.accountStatus,
    hydration: hydratedViewer
  });
  if (strictReady.rejected) {
    return strictReady.response;
  }
  logAuthAcceptedFullyReady({
    routeName: params.routeName,
    source: params.authProvider === "google" ? "google_existing" : "apple_existing",
    log: params.log,
    accountStatus: params.accountStatus,
    hydration: hydratedViewer
  });
  const token = await createCustomToken(params.resolvedUid);
  if (hydratedViewer.viewerReady) {
    await primeAuthSessionCacheFromSignin({
      viewerId: params.resolvedUid,
      provider: params.authProvider,
      viewerSummary: toSessionViewerSummary(hydratedViewer)
    });
  }
  logAuthIdCanonicalization(params.log, {
    routeName: params.routeName,
    viewerId: params.resolvedUid,
    canonicalUserId: hydratedViewer.canonicalUserId,
    providerUid: params.providerId,
    source: "oauth_existing",
    userDocFound: hydratedViewer.userDocFound
  });
  logAuthLoginViewerHydration(params.log, {
    routeName: params.routeName,
    viewerId: params.resolvedUid,
    canonicalUserId: hydratedViewer.canonicalUserId,
    providerUid: params.providerId,
    hydration: hydratedViewer,
    source: "oauth_existing"
  });
  return buildAppReadyAuthResponse({
    routeName: params.routeName,
    source: params.authProvider,
    token,
    user: {
      uid: params.resolvedUid,
      ...(params.email ? { email: params.email } : {}),
      ...(params.displayName ? { displayName: params.displayName } : {})
    },
    viewer: hydratedViewer,
    isNewUser: false,
    accountStatus: params.accountStatus
  });
}

export async function registerV2AuthMutationRoutes(app: FastifyInstance): Promise<void> {
  const authMutationsService = new AuthMutationsService();
  const firebaseToolkitContinueUri = resolveFirebaseToolkitContinueUri(app.config);

  app.get("/v2/auth/check-handle", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const query = CheckHandleQuery.parse(request.query);
    setRouteName("auth.check_handle.get");
    const { available, normalizedHandle } = await authMutationsService.isHandleAvailable(query.handle);
    return success({
      routeName: "auth.check_handle.get",
      success: true,
      available,
      normalizedHandle
    });
  });

  app.get("/v2/auth/check-user-exists", async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const query = CheckExistsQuery.parse(request.query);
    setRouteName("auth.check_user_exists.get");
    try {
      const exists = await checkUserExistsWithFallbacks(authMutationsService, query.email, firebaseToolkitContinueUri);
      return success({
        routeName: "auth.check_user_exists.get",
        success: true,
        exists: exists.exists,
        signInMethods: exists.signInMethods
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "check_user_exists_failed";
      return success({ routeName: "auth.check_user_exists.get", success: false, exists: false, error: message });
    }
  });

  app.post(authLoginContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthLoginBodySchema.parse(request.body);
    setRouteName(authLoginContract.routeName);
    try {
      const signIn = await signInWithPassword(body.email, body.password);
      const hasUserDoc = await authMutationsService.userDocExists(signIn.uid);
      if (!hasUserDoc) {
        return success({ routeName: authLoginContract.routeName, success: false, error: "profile_not_initialized" });
      }
      if (body.branchData && typeof body.branchData === "object" && Object.keys(body.branchData).length > 0) {
        await authMutationsService.mergeProfileBranch({ viewerId: signIn.uid, branchData: body.branchData }).catch(() => undefined);
      }
      const hydratedViewer = await authMutationsService.getCanonicalViewerHydration(signIn.uid);
      const accountStatus = hydratedViewer.onboardingComplete === false ? "existing_incomplete" : "existing_complete";
      const strictReady = rejectAuthWhenNotAppReady({
        routeName: authLoginContract.routeName,
        source: "email_password",
        log: request.log,
        accountStatus,
        hydration: hydratedViewer
      });
      if (strictReady.rejected) {
        return strictReady.response;
      }
      logAuthAcceptedFullyReady({
        routeName: authLoginContract.routeName,
        source: "email_password",
        log: request.log,
        accountStatus,
        hydration: hydratedViewer
      });
      const token = await createCustomToken(signIn.uid);
      if (hydratedViewer.viewerReady) {
        await primeAuthSessionCacheFromSignin({
          viewerId: signIn.uid,
          provider: "email_password",
          viewerSummary: toSessionViewerSummary(hydratedViewer)
        });
      }
      logAuthIdCanonicalization(request.log, {
        routeName: authLoginContract.routeName,
        viewerId: signIn.uid,
        canonicalUserId: hydratedViewer.canonicalUserId,
        source: "email_password",
        userDocFound: hydratedViewer.userDocFound
      });
      logAuthLoginViewerHydration(request.log, {
        routeName: authLoginContract.routeName,
        viewerId: signIn.uid,
        canonicalUserId: hydratedViewer.canonicalUserId,
        hydration: hydratedViewer,
        source: "email_password"
      });
      return buildAppReadyAuthResponse({
        routeName: authLoginContract.routeName,
        source: "login",
        token,
        user: { uid: signIn.uid, email: signIn.email, displayName: signIn.displayName },
        viewer: hydratedViewer,
        isNewUser: false,
        accountStatus
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "login_failed";
      let userMessage = rawMessage;
      let errorCode = rawMessage;
      try {
        const normalizedEmail = body.email.trim().toLowerCase();
        const existsResult = await checkUserExistsWithFallbacks(
          authMutationsService,
          normalizedEmail,
          firebaseToolkitContinueUri
        );
        const norm = normalizePasswordLoginFailure(rawMessage, existsResult.signInMethods, existsResult.exists);
        userMessage = norm.userMessage;
        errorCode = norm.errorCode;
        request.log.info(
          {
            event: "auth_login_failure_normalized",
            routeName: authLoginContract.routeName,
            attemptedProvider: "password",
            errorCode,
            hasEmail: true,
            normalizedProviderHint: norm.normalizedProviderHint ?? null
          },
          "auth_login_failure"
        );
      } catch {
        request.log.info(
          {
            event: "auth_login_failure_uncategorized",
            routeName: authLoginContract.routeName,
            attemptedProvider: "password",
            errorCode: rawMessage,
            hasEmail: true
          },
          "auth_login_failure"
        );
      }
      return success({ routeName: authLoginContract.routeName, success: false, error: userMessage, errorCode });
    }
  });

  app.post(authRegisterContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthRegisterBodySchema.parse(request.body);
    setRouteName(authRegisterContract.routeName);
    try {
      const user = await signUpWithPassword(body.email, body.password);
      const token = await createCustomToken(user.uid);
      const hydratedViewer = await authMutationsService.getCanonicalViewerHydration(user.uid);
      return buildAppReadyAuthResponse({
        routeName: authRegisterContract.routeName,
        source: "register",
        token,
        user: { uid: user.uid, email: user.email, displayName: user.displayName },
        viewer: hydratedViewer,
        isNewUser: true,
        accountStatus: hydratedViewer.onboardingComplete === false ? "new_account_required" : "existing_complete",
        profileCreated: hydratedViewer.onboardingComplete === true
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "register_failed";
      let userMessage = rawMessage;
      let errorCode = rawMessage;
      try {
        const normalizedEmail = body.email.trim().toLowerCase();
        const { signInMethods } = await checkUserExistsWithFallbacks(
          authMutationsService,
          normalizedEmail,
          firebaseToolkitContinueUri
        );
        const norm = normalizeRegisterFailure(rawMessage, signInMethods);
        userMessage = norm.userMessage;
        errorCode = norm.errorCode;
        request.log.info(
          {
            event: "auth_register_failure_normalized",
            routeName: authRegisterContract.routeName,
            attemptedProvider: "password_register",
            errorCode,
            hasEmail: true
          },
          "auth_register_failure"
        );
      } catch {
        request.log.info(
          {
            event: "auth_register_failure_uncategorized",
            routeName: authRegisterContract.routeName,
            attemptedProvider: "password_register",
            errorCode: rawMessage,
            hasEmail: true
          },
          "auth_register_failure"
        );
      }
      return success({ routeName: authRegisterContract.routeName, success: false, error: userMessage, errorCode });
    }
  });

  app.post(authSigninGoogleContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthSigninGoogleBodySchema.parse(request.body);
    setRouteName(authSigninGoogleContract.routeName);
    try {
      const trimmedId = typeof body.idToken === "string" ? body.idToken.trim() : "";
      const trimmedAccess = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
      const idp = await signInWithIdp(
        trimmedId
          ? { provider: "google.com", idToken: trimmedId }
          : trimmedAccess
            ? { provider: "google.com", accessToken: trimmedAccess }
            : (() => {
                throw new Error("MISSING_GOOGLE_OAUTH_TOKEN");
              })(),
        { continueUri: firebaseToolkitContinueUri }
      );
      const resolution = await authMutationsService.resolveOauthAccount({
        provider: "google",
        providerId: idp.providerId,
        firebaseUid: idp.uid,
        email: idp.email,
        idpIsNewUser: idp.isNewUser
      });
      return buildOauthSuccessResponse({
        routeName: authSigninGoogleContract.routeName,
        authProvider: "google",
        providerId: idp.providerId,
        email: idp.email,
        displayName: idp.displayName,
        resolvedUid: resolution.resolvedUid,
        accountStatus: resolution.accountStatus,
        branchData: body.branchData,
        authMutationsService,
        log: request.log,
        matchedExistingLocavaUser: resolution.matchedUser != null
      });
    } catch (error) {
      const supportive = classifyFirebaseAuthSupportingFailure(error);
      if (supportive) {
        request.log.warn(
          {
            event: "auth_google_failure_normalized",
            routeName: authSigninGoogleContract.routeName,
            attemptedProvider: "google",
            errorCode: supportive.errorCode,
            source: "supporting_service"
          },
          "oauth_failure"
        );
        return success({
          routeName: authSigninGoogleContract.routeName,
          success: false,
          error: supportive.userMessage,
          errorCode: supportive.errorCode
        });
      }

      const rawMessage =
        error instanceof IdentityToolkitExchangeError
          ? error.firebaseMessage
          : error instanceof Error
            ? error.message
            : "google_sign_in_failed";
      let userMessage = rawMessage;
      let errorCode = rawMessage;
      try {
        const token = typeof body.idToken === "string" ? body.idToken.trim() : "";
        const payload = decodeJwtPayloadUnverified(token.length > 0 ? token : null);
        let email =
          typeof payload?.email === "string" && payload.email.includes("@") ? payload.email.trim().toLowerCase() : "";
        if (!email) {
          const norm = normalizeOAuthSignInFailure({
            attemptedProvider: "google",
            firebaseErrorMessage: rawMessage,
            signInMethods: []
          });
          userMessage = norm.userMessage;
          errorCode = norm.errorCode;
        } else {
          const { signInMethods } = await checkUserExistsWithFallbacks(authMutationsService, email, firebaseToolkitContinueUri);
          const norm = normalizeOAuthSignInFailure({
            attemptedProvider: "google",
            firebaseErrorMessage: rawMessage,
            signInMethods
          });
          userMessage = norm.userMessage;
          errorCode = norm.errorCode;
        }
        request.log.info(
          {
            event: "auth_google_failure_normalized",
            routeName: authSigninGoogleContract.routeName,
            attemptedProvider: "google",
            errorCode,
            hasEmailHint: typeof body.idToken === "string" && body.idToken.trim().length > 0
          },
          "oauth_failure"
        );
      } catch {
        request.log.info(
          {
            event: "auth_google_failure_uncategorized",
            routeName: authSigninGoogleContract.routeName,
            attemptedProvider: "google",
            errorCode: rawMessage
          },
          "oauth_failure"
        );
      }
      return success({ routeName: authSigninGoogleContract.routeName, success: false, error: userMessage, errorCode });
    }
  });

  app.post(authSigninAppleContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthSigninAppleBodySchema.parse(request.body);
    setRouteName(authSigninAppleContract.routeName);

    const appleToolkitCtx: AppleToolkitClassifyContext = {
      appleIosBundleId: app.config.APPLE_IOS_BUNDLE_ID,
      appleWebServicesId: app.config.APPLE_WEB_SERVICES_ID
    };
    const bundleIdEcho =
      typeof app.config.APPLE_IOS_BUNDLE_ID === "string" && app.config.APPLE_IOS_BUNDLE_ID.trim().length > 0
        ? app.config.APPLE_IOS_BUNDLE_ID.trim()
        : "com.judsondunne.locava";
    const serviceIdEcho =
      typeof app.config.APPLE_WEB_SERVICES_ID === "string" && app.config.APPLE_WEB_SERVICES_ID.trim().length > 0
        ? app.config.APPLE_WEB_SERVICES_ID.trim()
        : "com.judsondunne.locava.web";

    const mode = body.oauthExchangeMode ?? "apple_identity_toolkit_rest";
    const identityJwt = typeof body.identityToken === "string" ? body.identityToken.trim() : "";

    if (mode === "firebase_apple_via_client_exchange") {
      try {
        const adminAuth = getFirebaseAuthClient();
        if (!adminAuth) {
          const fb = classifyFirebaseAuthSupportingFailure(new Error("firebase_auth_unavailable"));
          return success({
            routeName: authSigninAppleContract.routeName,
            success: false,
            error: fb?.userMessage ?? "Firebase Admin failed to initialize on the server.",
            errorCode: fb?.errorCode ?? "firebase_admin_unavailable",
            ...(app.config.ENABLE_DEV_DIAGNOSTICS && app.config.NODE_ENV !== "production"
              ? {
                  authDiagnostics: {
                    failurePhase: "firebase_client_exchange" as const,
                    oauthExchangeMode: mode,
                    bundleIdEcho,
                    serviceIdEcho,
                    recommendedFix: "Set GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_* service account vars) matching the Firebase project used by Locava Native."
                  }
                }
              : {})
          });
        }

        const token = typeof body.firebaseIdToken === "string" ? body.firebaseIdToken.trim() : "";
        const apid = await resolveAppleSignInViaFirebaseSessionIdToken(adminAuth, token);
        const resolution = await authMutationsService.resolveOauthAccount({
          provider: "apple",
          providerId: apid.appleProviderUid,
          firebaseUid: apid.firebaseUid,
          email: apid.email ?? body.email ?? null,
          idpIsNewUser: null
        });
        return buildOauthSuccessResponse({
          routeName: authSigninAppleContract.routeName,
          authProvider: "apple",
          providerId: apid.appleProviderUid,
          email: apid.email ?? body.email ?? null,
          displayName: apid.displayName ?? undefined,
          resolvedUid: resolution.resolvedUid,
          accountStatus: resolution.accountStatus,
          branchData: body.branchData,
          authMutationsService,
          log: request.log,
          matchedExistingLocavaUser: resolution.matchedUser != null
        });
      } catch (error) {
        let errorCode = "oauth_generic";
        let userMessage = "Apple sign-in failed. Try again in a moment or use Google or email.";
        let caughtMessage: string | undefined;

        const supportive = classifyFirebaseAuthSupportingFailure(error);
        if (supportive) {
          errorCode = supportive.errorCode;
          userMessage = supportive.userMessage;
        }

        caughtMessage =
          !(error instanceof FirebaseAppleIdTokenExchangeError) && error instanceof Error
            ? error.message.slice(0, 280)
            : error instanceof FirebaseAppleIdTokenExchangeError
              ? error.message.slice(0, 280)
              : undefined;

        request.log.warn(
          {
            event: "auth_apple_failure_normalized",
            routeName: authSigninAppleContract.routeName,
            attemptedProvider: "apple",
            oauthExchangeMode: mode,
            errorCode,
            failurePhase: "firebase_client_exchange",
            bundleIdEcho,
            serviceIdEcho,
            recommendedFix:
              supportive && error instanceof FirebaseAppleIdTokenExchangeError
                ? `Verify firebaseIdToken is from signInWithCredential(OAuthProvider('apple.com'), idToken=<Apple JWT>, rawNonce=<same raw nonce>). ${error.code}`
                : undefined
          },
          "oauth_failure"
        );

        const diagFb =
          app.config.ENABLE_DEV_DIAGNOSTICS && app.config.NODE_ENV !== "production"
            ? {
                authDiagnostics: {
                  oauthExchangeMode: mode,
                  failurePhase: "firebase_client_exchange" as const,
                  bundleIdEcho,
                  serviceIdEcho,
                  ...(caughtMessage ? { caughtMessage } : {})
                }
              }
            : {};
        return success({
          routeName: authSigninAppleContract.routeName,
          success: false,
          error: userMessage,
          errorCode,
          ...diagFb
        });
      }
    } else if (mode === "apple_native_jwk_verified") {
      const payloadJwPrecheck = decodeJwtPayloadUnverified(identityJwt);
      const nonceClaimJw =
        typeof payloadJwPrecheck?.nonce === "string" && payloadJwPrecheck.nonce.trim().length > 0
          ? payloadJwPrecheck.nonce.trim()
          : null;
      const rawNonceJwTrimmed = typeof body.rawNonce === "string" ? body.rawNonce.trim() : "";
      if (nonceClaimJw && rawNonceJwTrimmed.length < 8) {
        request.log.warn(
          {
            event: "auth_apple_failure_normalized",
            routeName: authSigninAppleContract.routeName,
            errorCode: "missing_nonce",
            failurePhase: "apple_jwk_verify",
            oauthExchangeMode: mode,
            nonceBodyLen: rawNonceJwTrimmed.length,
            jwtHasNonceClaim: true
          },
          "apple_jwk_nonce_precheck_failed"
        );
        return success({
          routeName: authSigninAppleContract.routeName,
          success: false,
          error:
            "Apple returned a hashed nonce claim but rawNonce was not sent to Backendv2. The Locava client must forward rawNonce (length ≥ 8) with identityToken.",
          errorCode: "missing_nonce",
          ...(app.config.ENABLE_DEV_DIAGNOSTICS && app.config.NODE_ENV !== "production"
            ? {
                authDiagnostics: {
                  failurePhase: "apple_jwk_verify" as const,
                  oauthExchangeMode: mode,
                  identityTokenJwtHasNonceClaim: true
                }
              }
            : {})
        });
      }
      let displayNameJwk: string | undefined;
      if (body.fullName) {
        if (typeof body.fullName === "string") displayNameJwk = body.fullName.trim() || undefined;
        else if (body.fullName.givenName || body.fullName.familyName) {
          displayNameJwk = [body.fullName.givenName, body.fullName.familyName].filter(Boolean).join(" ").trim() || undefined;
        }
      }
      try {
        const claims = await verifyAppleNativeIdentityJwt(identityJwt, {
          expectedAudienceBundleId: bundleIdEcho,
          rawNonce: rawNonceJwTrimmed.length >= 8 ? rawNonceJwTrimmed : typeof body.rawNonce === "string" ? body.rawNonce : null
        });
        const normalizedEmailJw = typeof body.email === "string" && body.email.includes("@") ? body.email.trim().toLowerCase() : null;
        const emailForResolution = claims.email ?? normalizedEmailJw;
        const legacyFirebaseUidJw = `apple_${claims.sub}`;
        const resolution = await authMutationsService.resolveOauthAccount({
          provider: "apple",
          providerId: claims.sub,
          firebaseUid: legacyFirebaseUidJw,
          email: emailForResolution,
          idpIsNewUser: null
        });
        return buildOauthSuccessResponse({
          routeName: authSigninAppleContract.routeName,
          authProvider: "apple",
          providerId: claims.sub,
          email: emailForResolution,
          displayName: displayNameJwk,
          resolvedUid: resolution.resolvedUid,
          accountStatus: resolution.accountStatus,
          branchData: body.branchData,
          authMutationsService,
          log: request.log,
          matchedExistingLocavaUser: resolution.matchedUser != null
        });
      } catch (error) {
        const jwtDiagJw = buildAppleJwtDiagnosticsUnverified(identityJwt);
        const supportive = classifyFirebaseAuthSupportingFailure(error);
        let errorCode = "oauth_generic";
        let userMessage = "Apple sign-in failed. Try again in a moment or use Google or email.";
        if (supportive) {
          errorCode = supportive.errorCode;
          userMessage = supportive.userMessage;
        }
        const caughtJw = error instanceof Error ? error.message.slice(0, 280) : undefined;
        request.log.warn(
          {
            event: "auth_apple_failure_normalized",
            routeName: authSigninAppleContract.routeName,
            attemptedProvider: "apple",
            oauthExchangeMode: mode,
            errorCode,
            failurePhase: "apple_jwk_verify",
            bundleIdEcho,
            appleTokenAudience: jwtDiagJw.appleTokenAudience ?? null,
            expectedAppleBundleAudience: bundleIdEcho,
            recommendedFix:
              "apple_native_jwk_verified verifies Apple JWKS locally (matches legacy Express). No Firebase Toolkit / client OAuth audience involved. If nonce fails: ensure expo SHA256+HEX nonce matches server SHA256(hex) of rawNonce."
          },
          "oauth_failure"
        );
        return success({
          routeName: authSigninAppleContract.routeName,
          success: false,
          error: userMessage,
          errorCode,
          ...(app.config.ENABLE_DEV_DIAGNOSTICS && app.config.NODE_ENV !== "production"
            ? {
                authDiagnostics: {
                  oauthExchangeMode: mode,
                  failurePhase: "apple_jwk_verify",
                  ...(jwtDiagJw.appleTokenAudience ? { appleTokenAudience: jwtDiagJw.appleTokenAudience } : {}),
                  firebaseExpectedAudienceToolkit: bundleIdEcho,
                  bundleIdEcho,
                  serviceIdEcho,
                  ...(caughtJw ? { caughtMessage: caughtJw } : {})
                }
              }
            : {})
        });
      }
    } else {
    try {
      const payloadPrecheck = decodeJwtPayloadUnverified(identityJwt);
      const nonceClaim =
        typeof payloadPrecheck?.nonce === "string" && payloadPrecheck.nonce.trim().length > 0
          ? payloadPrecheck.nonce.trim()
          : null;
      const rawNonceTrimmed = typeof body.rawNonce === "string" ? body.rawNonce.trim() : "";
      if (nonceClaim && rawNonceTrimmed.length < 8) {
        const jwtDiag = buildAppleJwtDiagnosticsUnverified(identityJwt);
        request.log.warn(
          {
            event: "auth_apple_failure_normalized",
            routeName: authSigninAppleContract.routeName,
            errorCode: "missing_nonce",
            failurePhase: "toolkit_precheck",
            oauthExchangeMode: mode,
            firebaseToolkitRawMessage: null,
            identityTokenJwtHasNonceClaim: true,
            nonceBodyLen: rawNonceTrimmed.length,
            appleTokenAudience: jwtDiag.appleTokenAudience ?? null,
            bundleIdEcho,
            serviceIdEcho,
            expectedFirebaseToolkitAudienceEcho: serviceIdEcho,
            recommendedFix:
              "Send rawNonce alongside identityToken whenever the Apple JWT includes a nonce claim (Firebase Identity Toolkit rejects missing nonce)."
          },
          "apple_nonce_precheck_failed"
        );
        const diagApple =
          app.config.ENABLE_DEV_DIAGNOSTICS && app.config.NODE_ENV !== "production"
            ? {
                authDiagnostics: {
                  failurePhase: "toolkit_precheck" as const,
                  oauthExchangeMode: mode,
                  firebaseToolkitRawMessage: null as string | null,
                  identityTokenJwtHasNonceClaim: true,
                  appleTokenAudience: jwtDiag.appleTokenAudience ?? undefined,
                  bundleIdEcho,
                  serviceIdEcho,
                  firebaseExpectedAudienceToolkit: serviceIdEcho,
                  recommendedFix:
                    "Apple returned a hashed nonce claim but rawNonce was not sent to Backendv2; forward rawNonce when calling POST /v2/auth/signin/apple."
                }
              }
            : {};
        return success({
          routeName: authSigninAppleContract.routeName,
          success: false,
          error:
            "Apple returned a hashed nonce claim but rawNonce was not sent to Backendv2. Verify the native client forwards rawNonce with identityToken (length >= 8).",
          errorCode: "missing_nonce",
          ...diagApple
        });
      }

      const rawNonce =
        typeof body.rawNonce === "string" && body.rawNonce.trim().length >= 8 ? body.rawNonce.trim() : "";
      const idp = await signInWithIdp(
        {
          provider: "apple.com",
          idToken: identityJwt,
          ...(rawNonce.length > 0 ? { appleRawNonce: rawNonce } : {})
        },
        { continueUri: firebaseToolkitContinueUri }
      );
      const resolution = await authMutationsService.resolveOauthAccount({
        provider: "apple",
        providerId: idp.providerId,
        firebaseUid: idp.uid,
        email: idp.email ?? body.email ?? null,
        idpIsNewUser: idp.isNewUser
      });
      return buildOauthSuccessResponse({
        routeName: authSigninAppleContract.routeName,
        authProvider: "apple",
        providerId: idp.providerId,
        email: idp.email ?? body.email ?? null,
        displayName: idp.displayName,
        resolvedUid: resolution.resolvedUid,
        accountStatus: resolution.accountStatus,
        branchData: body.branchData,
        authMutationsService,
        log: request.log,
        matchedExistingLocavaUser: resolution.matchedUser != null
      });
    } catch (error) {
      let errorCode = "oauth_generic";
      let userMessage = "Apple sign-in failed. Try again in a moment or use Google or email.";
      let firebaseToolkitRaw: string | undefined;
      let failurePhase: "toolkit_exchange" | "oauth_resolution" | "unknown" = "unknown";

      let classifiedToolkitMeta: ReturnType<typeof resolveAppleToolkitFailureMessaging>["toolkitMeta"];

      const jwtDiag = buildAppleJwtDiagnosticsUnverified(identityJwt);

      if (error instanceof IdentityToolkitExchangeError) {
        firebaseToolkitRaw = error.firebaseMessage;
        failurePhase = "toolkit_exchange";
        const classified = resolveAppleToolkitFailureMessaging(error.firebaseMessage, appleToolkitCtx);
        classifiedToolkitMeta = classified.toolkitMeta;
        errorCode = classified.errorCode;
        userMessage = classified.userMessage;
      } else {
        const nonToolkit = classifyFirebaseAuthSupportingFailure(error);
        if (nonToolkit) {
          failurePhase = "oauth_resolution";
          errorCode = nonToolkit.errorCode;
          userMessage = nonToolkit.userMessage;
        }
      }

      if (!(error instanceof IdentityToolkitExchangeError)) {
        const rawMessage = error instanceof Error ? error.message : "apple_sign_in_failed";
        if (firebaseToolkitRaw == null && failurePhase === "unknown") {
          try {
            const payload = decodeJwtPayloadUnverified(identityJwt);
            const jwtEmail =
              typeof payload?.email === "string" && payload.email.includes("@") ? payload.email.trim().toLowerCase() : "";
            const bodyEmail =
              typeof body.email === "string" && body.email.includes("@") ? body.email.trim().toLowerCase() : "";
            const email = jwtEmail || bodyEmail;
            const norm = normalizeOAuthSignInFailure({
              attemptedProvider: "apple",
              firebaseErrorMessage: rawMessage,
              signInMethods: email
                ? (await checkUserExistsWithFallbacks(authMutationsService, email, firebaseToolkitContinueUri)).signInMethods
                : []
            });
            userMessage = norm.userMessage;
            errorCode = norm.errorCode;
          } catch {
            request.log.info(
              {
                event: "auth_apple_failure_uncategorized",
                routeName: authSigninAppleContract.routeName,
                attemptedProvider: "apple",
                errorCode: rawMessage,
                firebaseToolkitRawMessage: firebaseToolkitRaw ?? null
              },
              "oauth_failure"
            );
          }
        }
      }

      const toolkitHttpStatus = error instanceof IdentityToolkitExchangeError ? error.httpStatus : null;
      request.log.warn(
        {
          event: "auth_apple_failure_normalized",
          routeName: authSigninAppleContract.routeName,
          attemptedProvider: "apple",
          oauthExchangeMode: mode,
          errorCode,
          failurePhase,
          firebaseToolkitRawMessage: firebaseToolkitRaw ?? null,
          toolkitHttpStatus,
          nonceProvidedLen: typeof body.rawNonce === "string" ? body.rawNonce.trim().length : 0,
          appleTokenAudience: jwtDiag.appleTokenAudience ?? null,
          expectedFirebaseToolkitAudience:
            classifiedToolkitMeta?.kind === "audience_mismatch"
              ? classifiedToolkitMeta.firebaseExpectedAudienceToolkit
              : serviceIdEcho,
          bundleIdEcho: classifiedToolkitMeta?.bundleIdConfigured ?? bundleIdEcho,
          serviceIdEcho: classifiedToolkitMeta?.webServicesIdConfigured ?? serviceIdEcho,
          recommendedFix:
            classifiedToolkitMeta?.kind === "audience_mismatch" ? classifiedToolkitMeta.recommendedFix : undefined,
          identityTokenJwtHasNonceClaim: jwtDiag.hasNonceClaim,
          ...(jwtDiag.header?.kid || jwtDiag.header?.alg
            ? { appleJwtHeaderAlg: jwtDiag.header?.alg, appleJwtHeaderKid: jwtDiag.header?.kid }
            : {})
        },
        "oauth_failure"
      );

      const diagAppleFail =
        app.config.ENABLE_DEV_DIAGNOSTICS && app.config.NODE_ENV !== "production"
          ? {
              authDiagnostics: {
                oauthExchangeMode: mode,
                failurePhase,
                firebaseToolkitRawMessage: firebaseToolkitRaw ?? undefined,
                identityToolkitHttpStatus: toolkitHttpStatus ?? undefined,
                identityTokenJwtHasNonceClaim: jwtDiag.hasNonceClaim,
                ...(jwtDiag.appleTokenAudience ? { appleTokenAudience: jwtDiag.appleTokenAudience } : {}),
                firebaseExpectedAudienceToolkit:
                  classifiedToolkitMeta?.kind === "audience_mismatch"
                    ? classifiedToolkitMeta.firebaseExpectedAudienceToolkit
                    : serviceIdEcho,
                bundleIdEcho: classifiedToolkitMeta?.bundleIdConfigured ?? bundleIdEcho,
                serviceIdEcho: classifiedToolkitMeta?.webServicesIdConfigured ?? serviceIdEcho,
                ...(classifiedToolkitMeta?.kind === "audience_mismatch"
                  ? { recommendedFix: classifiedToolkitMeta.recommendedFix }
                  : {}),
                ...(error instanceof Error && !(error instanceof IdentityToolkitExchangeError)
                  ? { caughtMessage: error.message.slice(0, 280) }
                  : {})
              }
            }
          : {};

      return success({
        routeName: authSigninAppleContract.routeName,
        success: false,
        error: userMessage,
        errorCode,
        ...diagAppleFail
      });
    }
    }
  });

  app.post(authProfileCreateContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthProfileCreateBodySchema.parse(request.body);
    setRouteName(authProfileCreateContract.routeName);
    const resolvedCreateProfile = await authMutationsService.resolveCreateProfileUser({
      requestedUserId: body.userId,
      oauthInfo: body.oauthInfo ?? null
    });
    if (body.oauthInfo) {
      logOauthDecision(request.log, {
        routeName: authProfileCreateContract.routeName,
        authProvider: body.oauthInfo.provider,
        providerUid: body.oauthInfo.providerId,
        email: body.email ?? body.oauthInfo.email ?? null,
        matchedExistingLocavaUser: resolvedCreateProfile.matchedUser != null,
        accountStatus: resolvedCreateProfile.accountStatus,
        userDocumentCreated: resolvedCreateProfile.matchedUser == null
      });
    }
    const created = await authMutationsService.createProfile({
      ...body,
      userId: resolvedCreateProfile.resolvedUid
    });
    const token = body.oauthInfo ? await createCustomToken(resolvedCreateProfile.resolvedUid) : undefined;
    const hydratedViewer = await authMutationsService.getCanonicalViewerHydration(resolvedCreateProfile.resolvedUid);
    if (hydratedViewer.viewerReady) {
      await primeAuthSessionCacheFromSignin({
        viewerId: resolvedCreateProfile.resolvedUid,
        provider: body.oauthInfo?.provider === "apple" ? "apple" : body.oauthInfo?.provider === "google" ? "google" : "email_password",
        viewerSummary: toSessionViewerSummary(hydratedViewer)
      });
    }
    return buildAppReadyAuthResponse({
      routeName: authProfileCreateContract.routeName,
      source: "profile_create",
      token,
      user: {
        uid: resolvedCreateProfile.resolvedUid,
        ...(body.email ? { email: body.email } : {}),
        displayName: body.name
      },
      viewer: hydratedViewer,
      isNewUser: false,
      accountStatus: "existing_complete",
      profileCreated: true,
      extra: {
        handle: created.handle,
        storage: created.storage
      }
    });
  });

  app.post(authProfileBranchMergeContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthProfileBranchMergeBodySchema.parse(request.body);
    setRouteName(authProfileBranchMergeContract.routeName);
    if (!viewer.viewerId || viewer.viewerId === "anonymous") {
      return success({ routeName: authProfileBranchMergeContract.routeName, success: false, error: "viewer_id_required" });
    }
    const result = await authMutationsService.mergeProfileBranch({
      viewerId: viewer.viewerId,
      branchData: body.branchData
    });
    return success({ routeName: authProfileBranchMergeContract.routeName, ...result });
  });

  app.post(authSignoutContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    AuthSignoutBodySchema.parse(request.body ?? {});
    setRouteName(authSignoutContract.routeName);
    if (!viewer.viewerId || viewer.viewerId === "anonymous") {
      return success({ routeName: authSignoutContract.routeName, success: false, error: "viewer_id_required" });
    }
    const result = await authMutationsService.signOutViewer(viewer.viewerId);
    return success({ routeName: authSignoutContract.routeName, success: true, ...result });
  });

  app.post(authDeleteAccountContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    AuthDeleteAccountBodySchema.parse(request.body ?? {});
    setRouteName(authDeleteAccountContract.routeName);
    if (!viewer.viewerId || viewer.viewerId === "anonymous") {
      return success({ routeName: authDeleteAccountContract.routeName, success: false, error: "viewer_id_required" });
    }
    try {
      const result = await authMutationsService.deleteViewerAccount(viewer.viewerId);
      return success({ routeName: authDeleteAccountContract.routeName, success: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "delete_account_failed";
      return success({ routeName: authDeleteAccountContract.routeName, success: false, error: message });
    }
  });
}
