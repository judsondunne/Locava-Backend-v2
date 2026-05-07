import {
  assertFirebaseAccessAllowed,
  parseFirebaseAccessEnv,
  type FirebaseOperationType
} from "@locava/contracts/firebase-access-policy";
import { classifyFirebaseAccessForRequest, pathnameOnly } from "../config/firebase-access-gate.js";
import { getFirebaseAccessGateFromBackground } from "./firebase-access-gate-context.js";
import { getRequestContext } from "../observability/request-context.js";

/**
 * Enforce Firebase Admin / Firestore access policy before touching Admin SDK.
 */
export function enforceBackendV2FirebaseAccess(opts: { operationType: FirebaseOperationType }): void {
  const env = parseFirebaseAccessEnv(process.env);
  const bgGate = getFirebaseAccessGateFromBackground();
  const req = getRequestContext();
  const gate = bgGate ?? req?.firebaseAccess;
  const routePath = req?.route ? pathnameOnly(req.route) : undefined;

  if (!gate) {
    assertFirebaseAccessAllowed(
      {
        surface: "startup-or-no-request-context",
        route: routePath,
        operationType: opts.operationType,
        legacy: false,
        runtime: "backend",
        allowCategory: "BACKEND_V2_ALLOWED"
      },
      env,
      { routePath }
    );
    return;
  }

  assertFirebaseAccessAllowed(
    {
      surface: gate.surface,
      route: routePath,
      operationType: opts.operationType,
      legacy: gate.legacy,
      runtime: "backend",
      allowCategory: gate.allowCategory
    },
    env,
    { routePath }
  );
}

/** When no HTTP request exists, run work under an explicit gate (e.g. tests). */
export function resolveFirebaseGateForBackground(
  method: string,
  url: string
): import("./firebase-access-gate-context.js").FirebaseAccessGate {
  return classifyFirebaseAccessForRequest(method, url);
}
