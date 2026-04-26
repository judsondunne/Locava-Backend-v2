import os from "node:os";

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

export function printDevListenUrlBanner(port: number, nodeEnv: string, legacyMonolithProxyBaseUrl?: string): void {
  if (nodeEnv === "production") return;

  const lan = collectDevHttpBaseUrls(port);
  const legacyLine =
    legacyMonolithProxyBaseUrl && legacyMonolithProxyBaseUrl.trim().length > 0
      ? `  OAuth/email auth: proxied → ${legacyMonolithProxyBaseUrl.trim()}`
      : "  OAuth/email auth: served natively by Backendv2 (/v2/auth/*).";
  const lines = [
    "",
    "================================================================================",
    "  Locava Backendv2 — point Locava-Native at one of these (port " + String(port) + ")",
    "================================================================================",
    "",
    "  Physical phone / LAN Expo: use an http://<LAN-IP> line (NOT localhost).",
    legacyLine,
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
