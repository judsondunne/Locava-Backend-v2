/**
 * Feed/location parity probe against a running Backendv2 server.
 *
 * Fails when fallback-synthesized feed data is detected.
 */
const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";

type Probe = { method: "GET" | "POST"; path: string; body?: unknown; label: string };

async function call(p: Probe): Promise<{ status: number; payload: any }> {
  const res = await fetch(`${BASE_URL}${p.path}`, {
    method: p.method,
    headers: {
      "x-viewer-id": VIEWER_ID,
      "x-viewer-roles": "internal",
      ...(p.body ? { "content-type": "application/json" } : {})
    },
    body: p.body ? JSON.stringify(p.body) : undefined
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

function classify(label: string, status: number, payload: any): string {
  if (status >= 500) return "FAILED";
  if (status === 503) return "FAILED";
  const src =
    payload?.data?.source ??
    payload?.source ??
    (Array.isArray(payload?.data?.fallbacks) && payload.data.fallbacks.includes("monolith_proxy")
      ? "monolith_proxy"
      : null);
  if (src === "firestore_real") return "REAL_FIRESTORE";
  if (src === "monolith_proxy") return "MONOLITH_PROXY";
  if (label.includes("/feed/") || label.includes("feed")) {
    const fb = payload?.data?.fallbacks ?? payload?.fallbacks ?? [];
    if (Array.isArray(fb) && fb.some((v: unknown) => String(v).includes("fallback"))) return "FAKE_FALLBACK_DETECTED";
  }
  return status >= 200 && status < 300 ? "REAL_FIRESTORE" : "FAILED";
}

async function main(): Promise<void> {
  const probes: Probe[] = [
    { label: "health", method: "GET", path: "/health" },
    { label: "v2_feed_bootstrap", method: "GET", path: "/v2/feed/bootstrap?limit=5&tab=explore" },
    { label: "v2_feed_page", method: "GET", path: "/v2/feed/page?limit=5&tab=explore&cursor=cursor:5" },
    { label: "v2_feed_following", method: "GET", path: "/v2/feed/bootstrap?limit=5&tab=following" },
    { label: "legacy_near_me_count_25", method: "GET", path: "/api/v1/product/reels/near-me/count?lat=39.5&lng=-98.35&radiusMiles=25" },
    { label: "legacy_near_me_5", method: "GET", path: "/api/v1/product/reels/near-me?lat=39.5&lng=-98.35&radiusMiles=5&limit=5" },
    { label: "legacy_near_me_10", method: "GET", path: "/api/v1/product/reels/near-me?lat=39.5&lng=-98.35&radiusMiles=10&limit=5" },
    { label: "legacy_near_me_25", method: "GET", path: "/api/v1/product/reels/near-me?lat=39.5&lng=-98.35&radiusMiles=25&limit=5" },
    { label: "legacy_near_me_50", method: "GET", path: "/api/v1/product/reels/near-me?lat=39.5&lng=-98.35&radiusMiles=50&limit=5" },
    { label: "legacy_near_me_100", method: "GET", path: "/api/v1/product/reels/near-me?lat=39.5&lng=-98.35&radiusMiles=100&limit=5" },
    { label: "legacy_location_autocomplete", method: "GET", path: "/api/v1/product/location/autocomplete?q=Boston" },
    { label: "legacy_forward_geocode", method: "POST", path: "/api/v1/product/location/forward-geocode", body: { text: "Boston MA" } },
    { label: "legacy_reverse_geocode", method: "GET", path: "/api/v1/product/location/reverse-geocode?lat=42.3601&lng=-71.0589" },
    { label: "location_selected_reload", method: "GET", path: "/v2/feed/bootstrap?limit=5&tab=explore&lat=42.3601&lng=-71.0589&radiusKm=40.2335" }
  ];

  let failures = 0;
  for (const p of probes) {
    const res = await call(p).catch((error) => ({ status: 0, payload: { error: String(error) } }));
    const state = classify(p.label, res.status, res.payload);
    console.log(`${p.label}: ${state} (status=${res.status})`);
    if (state === "FAILED" || state === "FAKE_FALLBACK_DETECTED") failures += 1;
  }
  if (failures > 0) process.exit(1);
}

await main();
