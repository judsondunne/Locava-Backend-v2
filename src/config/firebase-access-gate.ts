import type { FirebaseAccessGate } from "../lib/firebase-access-gate-context.js";

function requestPathname(rawUrl: string): string {
  try {
    return new URL(rawUrl, "http://127.0.0.1").pathname;
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}

/**
 * Classify Firebase access for an HTTP request on Backendv2 (canonical + compat surfaces only).
 */
export function classifyFirebaseAccessForRequest(method: string, rawUrl: string): FirebaseAccessGate {
  void method;
  const path = requestPathname(rawUrl);

  if (path.startsWith("/v2/")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: false, surface: "backend-v2" };
  }
  if (path.startsWith("/internal/")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: false, surface: "internal" };
  }
  if (path.startsWith("/debug/")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: false, surface: "debug" };
  }
  if (path.startsWith("/test/")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: false, surface: "test" };
  }
  if (path.startsWith("/api/v1/product/")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: true, surface: "legacy-product-compat" };
  }
  if (path.startsWith("/api/auth/") || path.startsWith("/api/users/")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: true, surface: "legacy-auth-proxy-shape" };
  }
  if (path.startsWith("/api/public/") || path.startsWith("/api/config/") || path.startsWith("/api/analytics/")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: false, surface: "api-aux" };
  }
  if (path.startsWith("/api/notifications")) {
    return { allowCategory: "BACKEND_V2_ALLOWED", legacy: true, surface: "notifications-proxy" };
  }

  return { allowCategory: "BACKEND_V2_ALLOWED", legacy: false, surface: "backend-v2-catchall" };
}

export function pathnameOnly(rawUrl: string): string {
  return requestPathname(rawUrl);
}
