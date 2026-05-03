/**
 * npm run debug:search:suggest -- "Hartland Vermont" --lat 40.698217737415355 --lng -75.21066906243718
 */
import process from "node:process";

const baseUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8080";
const headers = {
  "x-viewer-id": process.env.DEBUG_VIEWER_ID ?? "internal-viewer",
  "x-viewer-roles": "internal",
};

function parseArgs(argv: string[]): { q: string; lat?: number; lng?: number } {
  const positional: string[] = [];
  let lat: number | undefined;
  let lng: number | undefined;
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--lat" && argv[i + 1]) {
      lat = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (a === "--lng" && argv[i + 1]) {
      lng = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (!a.startsWith("--")) positional.push(a);
  }
  const q = positional.join(" ").trim();
  return { q, lat, lng };
}

async function run(): Promise<void> {
  const { q, lat, lng } = parseArgs(process.argv);
  if (!q) {
    console.error("Usage: npm run debug:search:suggest -- \"Your Query\" [--lat N] [--lng N]");
    process.exit(1);
  }
  const sp = new URLSearchParams();
  sp.set("q", q);
  if (typeof lat === "number" && Number.isFinite(lat)) sp.set("lat", String(lat));
  if (typeof lng === "number" && Number.isFinite(lng)) sp.set("lng", String(lng));

  const url = `${baseUrl.replace(/\/+$/, "")}/v2/search/suggest?${sp.toString()}`;
  const res = await fetch(url, { headers });
  const body = (await res.json()) as {
    data?: {
      suggestions?: Array<{ text?: string; type?: string; data?: Record<string, unknown> }>;
      suggestDiagnostics?: Record<string, unknown>;
    };
  };
  const payload = body.data;
  const diag = payload?.suggestDiagnostics ?? {};
  console.log("[debug:search:suggest] http", { status: res.status, url });
  console.log("[debug:search:suggest] diagnostics", diag);
  const rows = payload?.suggestions ?? [];
  console.log("[debug:search:suggest] top suggestions");
  for (const [i, row] of rows.slice(0, 12).entries()) {
    const latv = row.data?.lat ?? row.data?.latitude;
    const lngv = row.data?.lng ?? row.data?.lon ?? row.data?.longitude;
    console.log(
      `${i + 1}. type=${row.type} text=${JSON.stringify(row.text ?? "")} lat=${latv ?? "?"} lng=${lngv ?? "?"}`,
    );
  }
}

void run();
