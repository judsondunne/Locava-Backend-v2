import type { FirebaseAccessEnv } from "@locava/contracts/firebase-access-policy";
import {
  isLegacyCompatFirestoreDisabled,
  isLockedDown,
  parseFirebaseAccessEnv
} from "@locava/contracts/firebase-access-policy";
import type { AppEnv } from "./env.js";
import { pathnameOnly } from "./firebase-access-gate.js";

export type LegacyRouteShutdownResult = {
  statusCode: 503 | 410;
  body: Record<string, unknown>;
};

/** Merge Fastify `app.config` Firebase policy fields over `process.env` for consistent containment checks in tests and runtime. */
export function firebasePolicyEnvFromAppConfig(appEnv: AppEnv): FirebaseAccessEnv {
  return parseFirebaseAccessEnv({
    ...process.env,
    LOCAVA_FIREBASE_ACCESS_MODE: appEnv.LOCAVA_FIREBASE_ACCESS_MODE,
    DISABLE_LEGACY_FIREBASE: String(appEnv.DISABLE_LEGACY_FIREBASE),
    DISABLE_LEGACY_WORKERS: String(appEnv.DISABLE_LEGACY_WORKERS),
    DISABLE_LEGACY_CRON: String(appEnv.DISABLE_LEGACY_CRON),
    DISABLE_LEGACY_LISTENERS: String(appEnv.DISABLE_LEGACY_LISTENERS),
    DISABLE_LEGACY_ANALYTICS_FIRESTORE: String(appEnv.DISABLE_LEGACY_ANALYTICS_FIRESTORE),
    DISABLE_LEGACY_FEED_FIRESTORE: String(appEnv.DISABLE_LEGACY_FEED_FIRESTORE),
    DISABLE_LEGACY_SEARCH_FIRESTORE: String(appEnv.DISABLE_LEGACY_SEARCH_FIRESTORE),
    DISABLE_LEGACY_PROFILE_FIRESTORE: String(appEnv.DISABLE_LEGACY_PROFILE_FIRESTORE),
    DISABLE_LEGACY_POST_FIRESTORE: String(appEnv.DISABLE_LEGACY_POST_FIRESTORE),
    DISABLE_LEGACY_NOTIFICATIONS_FIRESTORE: String(appEnv.DISABLE_LEGACY_NOTIFICATIONS_FIRESTORE),
    DISABLE_LEGACY_MAP_FIRESTORE: String(appEnv.DISABLE_LEGACY_MAP_FIRESTORE),
    DISABLE_LEGACY_REELS_FIRESTORE: String(appEnv.DISABLE_LEGACY_REELS_FIRESTORE),
    DISABLE_LEGACY_USERS_FIRESTORE: String(appEnv.DISABLE_LEGACY_USERS_FIRESTORE),
    DISABLE_LEGACY_COLLECTIONS_FIRESTORE: String(appEnv.DISABLE_LEGACY_COLLECTIONS_FIRESTORE),
    ALLOW_BACKEND_V2_FIREBASE: String(appEnv.ALLOW_BACKEND_V2_FIREBASE),
    ALLOW_WIKIMEDIA_MVP_FIREBASE: String(appEnv.ALLOW_WIKIMEDIA_MVP_FIREBASE),
    ALLOW_WIKIMEDIA_STAGING_FIREBASE: String(appEnv.ALLOW_WIKIMEDIA_STAGING_FIREBASE),
    ALLOW_BACKEND_V2_MONOLITH_PROXY: String(appEnv.ALLOW_BACKEND_V2_MONOLITH_PROXY),
    ENABLE_FIREBASE_ACCESS_POLICY_LOGS: String(appEnv.ENABLE_FIREBASE_ACCESS_POLICY_LOGS),
    ENABLE_FIREBASE_ACCESS_DEBUG_ENDPOINT: String(appEnv.ENABLE_FIREBASE_ACCESS_DEBUG_ENDPOINT)
  });
}

/**
 * Fast reject for legacy compat HTTP routes before handlers run (locked_down + granular flags).
 */
export function evaluateLegacyRouteShutdown(
  rawUrl: string,
  policyEnv: FirebaseAccessEnv = parseFirebaseAccessEnv(process.env)
): LegacyRouteShutdownResult | null {
  const env = policyEnv;
  if (!isLockedDown(env) || !env.DISABLE_LEGACY_FIREBASE) {
    return null;
  }
  const path = pathnameOnly(rawUrl);
  if (!isLegacyCompatFirestoreDisabled(path, env)) {
    return null;
  }
  return {
    statusCode: 503,
    body: {
      ok: false,
      disabled: true,
      code: "LEGACY_FIREBASE_DISABLED",
      message: "This legacy Firebase-backed route is disabled to prevent runaway Firestore reads.",
      route: path,
      allowedAlternatives: ["/v2/*"]
    }
  };
}
