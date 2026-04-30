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
import { AuthMutationsService } from "../../services/mutations/auth-mutations.service.js";

const CheckHandleQuery = z.object({
  handle: z.string().trim().min(1).max(40)
});
const CheckExistsQuery = z.object({
  email: z.string().trim().email()
});

function makeOauthUid(provider: "google" | "apple", providerId: string): string {
  return `${provider}_${providerId}`;
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

async function checkUserExistsByEmail(email: string): Promise<{ exists: boolean; signInMethods: string[] }> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("firebase_web_api_key_missing");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: email,
        continueUri: "https://locava.app/auth/callback"
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
  email: string
): Promise<{ exists: boolean; signInMethods: string[] }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return { exists: false, signInMethods: [] };

  const [userDocExists, authUserExists] = await Promise.all([
    authMutationsService.userDocExistsByEmail(normalizedEmail),
    authMutationsService.authUserExistsByEmail(normalizedEmail)
  ]);
  if (userDocExists || authUserExists) {
    return { exists: true, signInMethods: [] };
  }
  return checkUserExistsByEmail(normalizedEmail);
}

async function signInWithIdp(params: {
  provider: "google.com" | "apple.com";
  accessToken?: string;
  idToken?: string;
}): Promise<{ uid: string; providerId: string; email: string; displayName?: string; isNewUser: boolean | null }> {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) throw new Error("firebase_web_api_key_missing");
  const postBodyBits: string[] = [`providerId=${params.provider}`];
  if (params.accessToken) postBodyBits.push(`access_token=${encodeURIComponent(params.accessToken)}`);
  if (params.idToken) postBodyBits.push(`id_token=${encodeURIComponent(params.idToken)}`);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestUri: "https://locava.app/auth/callback",
        returnSecureToken: true,
        returnIdpCredential: true,
        postBody: postBodyBits.join("&")
      })
    }
  );
  const json = (await res.json()) as {
    localId?: string;
    isNewUser?: boolean;
    email?: string;
    displayName?: string;
    rawUserInfo?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? "idp_sign_in_failed");
  }
  const raw = (() => {
    try {
      return json.rawUserInfo ? (JSON.parse(json.rawUserInfo) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  const providerId = String(raw.sub ?? raw.user_id ?? raw.id ?? "").trim();
  if (!providerId) throw new Error("provider_id_missing");
  const uid = String(json.localId ?? "").trim();
  if (!uid) throw new Error("firebase_uid_missing");
  const email = String(json.email ?? raw.email ?? "").trim();
  if (!email) throw new Error("provider_email_missing");
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
  return auth.createCustomToken(uid);
}

export async function registerV2AuthMutationRoutes(app: FastifyInstance): Promise<void> {
  const authMutationsService = new AuthMutationsService();

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
      const exists = await checkUserExistsWithFallbacks(authMutationsService, query.email);
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
      const token = await createCustomToken(signIn.uid);
      return success({
        routeName: authLoginContract.routeName,
        success: true,
        user: { uid: signIn.uid, email: signIn.email, displayName: signIn.displayName },
        token
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "login_failed";
      return success({ routeName: authLoginContract.routeName, success: false, error: message });
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
      return success({
        routeName: authRegisterContract.routeName,
        success: true,
        user: { uid: user.uid, email: user.email, displayName: user.displayName },
        token
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "register_failed";
      return success({ routeName: authRegisterContract.routeName, success: false, error: message });
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
      const idp = await signInWithIdp({ provider: "google.com", accessToken: body.accessToken });
      const firebaseUid = idp.uid;
      const legacyOauthUid = makeOauthUid("google", idp.providerId);
      const hasFirebaseUserDoc = await authMutationsService.userDocExists(firebaseUid);
      const hasLegacyOauthUserDoc = hasFirebaseUserDoc ? false : await authMutationsService.userDocExists(legacyOauthUid);
      const resolvedUid = hasFirebaseUserDoc ? firebaseUid : hasLegacyOauthUserDoc ? legacyOauthUid : firebaseUid;
      const hasUserDoc = hasFirebaseUserDoc || hasLegacyOauthUserDoc;
      const existingIdentityByEmail =
        body.authIntent === "sign_in" ? await checkUserExistsByEmail(idp.email).then((x) => x.exists).catch(() => false) : false;
      // Sign-in intent must never route users into onboarding from this endpoint.
      // Old backend behavior: pressing Google sign-in means "authenticate now".
      if (body.authIntent === "sign_in") {
        const token = await createCustomToken(resolvedUid);
        return success({
          routeName: authSigninGoogleContract.routeName,
          success: true,
          isNewUser: false,
          user: { uid: resolvedUid, email: idp.email, displayName: idp.displayName },
          token
        });
      }
      const treatAsExistingUser = hasUserDoc || idp.isNewUser === false || existingIdentityByEmail;
      if (!treatAsExistingUser) {
        return success({
          routeName: authSigninGoogleContract.routeName,
          success: true,
          isNewUser: true,
          user: { uid: resolvedUid, email: idp.email, displayName: idp.displayName },
          oauthInfo: {
            provider: "google",
            providerId: idp.providerId,
            email: idp.email,
            displayName: idp.displayName
          }
        });
      }
      const token = await createCustomToken(resolvedUid);
      return success({
        routeName: authSigninGoogleContract.routeName,
        success: true,
        isNewUser: false,
        user: { uid: resolvedUid, email: idp.email, displayName: idp.displayName },
        token
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "google_sign_in_failed";
      return success({ routeName: authSigninGoogleContract.routeName, success: false, error: message });
    }
  });

  app.post(authSigninAppleContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthSigninAppleBodySchema.parse(request.body);
    setRouteName(authSigninAppleContract.routeName);
    try {
      const idp = await signInWithIdp({ provider: "apple.com", idToken: body.identityToken });
      const firebaseUid = idp.uid;
      const legacyOauthUid = makeOauthUid("apple", idp.providerId);
      const hasFirebaseUserDoc = await authMutationsService.userDocExists(firebaseUid);
      const hasLegacyOauthUserDoc = hasFirebaseUserDoc ? false : await authMutationsService.userDocExists(legacyOauthUid);
      const resolvedUid = hasFirebaseUserDoc ? firebaseUid : hasLegacyOauthUserDoc ? legacyOauthUid : firebaseUid;
      const hasUserDoc = hasFirebaseUserDoc || hasLegacyOauthUserDoc;
      const existingIdentityByEmail =
        body.authIntent === "sign_in" ? await checkUserExistsByEmail(idp.email).then((x) => x.exists).catch(() => false) : false;
      // Mirror Google behavior for Apple sign-in intent.
      if (body.authIntent === "sign_in") {
        const token = await createCustomToken(resolvedUid);
        return success({
          routeName: authSigninAppleContract.routeName,
          success: true,
          isNewUser: false,
          user: { uid: resolvedUid, email: idp.email, displayName: idp.displayName },
          token
        });
      }
      const treatAsExistingUser = hasUserDoc || idp.isNewUser === false || existingIdentityByEmail;
      if (!treatAsExistingUser) {
        return success({
          routeName: authSigninAppleContract.routeName,
          success: true,
          isNewUser: true,
          user: { uid: resolvedUid, email: idp.email, displayName: idp.displayName },
          oauthInfo: {
            provider: "apple",
            providerId: idp.providerId,
            email: idp.email,
            displayName: idp.displayName
          }
        });
      }
      const token = await createCustomToken(resolvedUid);
      return success({
        routeName: authSigninAppleContract.routeName,
        success: true,
        isNewUser: false,
        user: { uid: resolvedUid, email: idp.email, displayName: idp.displayName },
        token
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "apple_sign_in_failed";
      return success({ routeName: authSigninAppleContract.routeName, success: false, error: message });
    }
  });

  app.post(authProfileCreateContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }
    const body = AuthProfileCreateBodySchema.parse(request.body);
    setRouteName(authProfileCreateContract.routeName);
    const created = await authMutationsService.createProfile(body);
    const token = body.oauthInfo ? await createCustomToken(body.userId) : undefined;
    return success({
      routeName: authProfileCreateContract.routeName,
      ...created,
      token
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
