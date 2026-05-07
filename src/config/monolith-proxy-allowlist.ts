import {
  FirebaseAccessDeniedError,
  isLockedDown,
  parseFirebaseAccessEnv
} from "@locava/contracts/firebase-access-policy";

/** Exact auth JSON proxy paths (legacy-monolith-auth-proxy.routes.ts). */
export const MONOLITH_AUTH_JSON_PATHS = [
  "/api/auth/check-handle",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/signin/google",
  "/api/auth/signin/apple",
  "/api/auth/profile",
  "/api/auth/profile/branch",
  "/api/users/check-exists"
] as const;

export const MONOLITH_PRODUCT_LOCATION_PREFIX = "/api/v1/product/location";
export const MONOLITH_PRODUCT_DYNAMIC_COLLECTIONS_PREFIX = "/api/v1/product/dynamic-collections";
export const MONOLITH_PRODUCT_REELS_PREFIX = "/api/v1/product/reels";

export const MONOLITH_UPLOAD_CREATE_FROM_STAGED = "/api/v1/product/upload/create-from-staged";

/** Notification mutation proxy prefix (legacy-monolith-notifications-proxy.routes.ts). */
export const MONOLITH_NOTIFICATIONS_PREFIX = "/api/notifications";

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Returns true if monolith outbound path is allowlisted for Backend V2 proxy/publish flows.
 */
export function isMonolithProxyPathAllowlisted(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  if (MONOLITH_AUTH_JSON_PATHS.some((x) => p === x || p.startsWith(`${x}/`))) {
    return true;
  }
  if (
    pathMatchesPrefix(p, MONOLITH_PRODUCT_LOCATION_PREFIX) ||
    pathMatchesPrefix(p, MONOLITH_PRODUCT_DYNAMIC_COLLECTIONS_PREFIX) ||
    pathMatchesPrefix(p, MONOLITH_PRODUCT_REELS_PREFIX)
  ) {
    return true;
  }
  if (p === MONOLITH_UPLOAD_CREATE_FROM_STAGED || p.startsWith(`${MONOLITH_UPLOAD_CREATE_FROM_STAGED}/`)) {
    return true;
  }
  if (pathMatchesPrefix(p, MONOLITH_NOTIFICATIONS_PREFIX)) {
    return true;
  }
  return false;
}

/**
 * Assert monolith outbound URL pathname is allowlisted when locked_down + monolith proxy allowed.
 */
export function assertMonolithProxyOutboundAllowed(absoluteUrl: string): void {
  const env = parseFirebaseAccessEnv(process.env);
  if (!isLockedDown(env)) return;
  let pathname: string;
  try {
    pathname = new URL(absoluteUrl).pathname;
  } catch {
    throw new FirebaseAccessDeniedError({
      surface: "monolith-outbound",
      operationType: "api",
      legacy: true,
      runtime: "backend",
      allowCategory: "BLOCKED_LEGACY",
      reason: "Invalid monolith outbound URL"
    });
  }
  if (!env.ALLOW_BACKEND_V2_MONOLITH_PROXY) {
    throw new FirebaseAccessDeniedError({
      surface: "monolith-outbound",
      route: pathname,
      operationType: "api",
      legacy: true,
      runtime: "backend",
      allowCategory: "LEGACY_MONOLITH_REQUIRED_BY_V2",
      reason: "ALLOW_BACKEND_V2_MONOLITH_PROXY=false in locked_down"
    });
  }
  if (!isMonolithProxyPathAllowlisted(pathname)) {
    throw new FirebaseAccessDeniedError({
      surface: "monolith-outbound",
      route: pathname,
      operationType: "api",
      legacy: true,
      runtime: "backend",
      allowCategory: "BLOCKED_LEGACY",
      reason: "Monolith path not in BACKEND_V2_REQUIRED_LEGACY_PROXY allowlist"
    });
  }
}

export const BACKEND_V2_REQUIRED_LEGACY_PROXY_PATHS: string[] = [
  ...MONOLITH_AUTH_JSON_PATHS,
  `${MONOLITH_PRODUCT_LOCATION_PREFIX}/*`,
  `${MONOLITH_PRODUCT_DYNAMIC_COLLECTIONS_PREFIX}/*`,
  `${MONOLITH_PRODUCT_REELS_PREFIX}/*`,
  MONOLITH_UPLOAD_CREATE_FROM_STAGED,
  `${MONOLITH_NOTIFICATIONS_PREFIX}/*`
];
