import os from "node:os";
import type { AppEnv } from "../config/env.js";

/**
 * Human-visible URLs for dev: physical phones / LAN Metro must use a
 * non-loopback base (see Locava-Native `getBackendV2Url`).
 */
export function collectDevHttpBaseUrls(port: number): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (a.internal) continue;
      if (a.family !== "IPv4") continue;
      out.push(`http://${a.address}:${port}`);
    }
  }
  return [...new Set(out)].sort();
}

export function printDevListenUrlBanner(port: number, nodeEnv: string, env: Pick<AppEnv, "LEGACY_MONOLITH_PROXY_BASE_URL" | "ENABLE_LEGACY_COMPAT_ROUTES">): void {
  if (nodeEnv === "production") return;

  const lan = collectDevHttpBaseUrls(port);
  const legacyUrl = typeof env.LEGACY_MONOLITH_PROXY_BASE_URL === "string" ? env.LEGACY_MONOLITH_PROXY_BASE_URL.trim() : "";
  const legacyConfigured = legacyUrl.length > 0;
  const legacyLine = legacyConfigured
    ? `  LEGACY_MONOLITH_PROXY_BASE_URL → ${legacyUrl}
     (classic /api compat + upload proxies only when ENABLE_LEGACY_COMPAT_ROUTES=1; NOT used for POST /v2/auth/signin/*)`
    : "  LEGACY_MONOLITH_PROXY_BASE_URL unset (legacy /api proxies disabled unless compat enabled + base set later).";
  const v2AuthLine =
    "  Apple/Google/email v2 surfaces: Backendv2 calls Firebase Identity Toolkit directly (needs FIREBASE_WEB_API_KEY matching the app's Firebase project).";
  const lines = [
    "",
    "================================================================================",
    "  Locava Backendv2 — point Locava-Native at one of these (port " + String(port) + ")",
    "================================================================================",
    "",
    "  Physical phone / LAN Expo: use an http://<LAN-IP> line (NOT localhost).",
    legacyLine,
    v2AuthLine,
    "",
    "  Optional .env:",
    "",
    ...lan.map((u) => `    EXPO_PUBLIC_BACKEND_V2_URL=${u}`),
    "",
    "  Same machine / iOS Simulator (Backendv2 on this Mac):",
    `    EXPO_PUBLIC_BACKEND_V2_URL=http://127.0.0.1:${port}`,
    "",
    "  Health check:",
    ...(lan.length > 0
      ? [
          ...lan.slice(0, 3).map((u) => `    curl -sS ${u}/health`),
          ...(lan.length > 3 ? [`    … (+${String(lan.length - 3)} more LAN URLs above)`] : []),
        ]
      : [`    curl -sS http://127.0.0.1:${port}/health`]),
    "================================================================================",
    "",
  ];

  for (const line of lines) {
    // eslint-disable-next-line no-console -- intentional dev banner
    console.log(line);
  }
}
