/**
 * Local autocomplete harness — exercises SearchAutofillService + places index (no mocks).
 *
 * Usage (from Locava Backendv2/):
 *   npx tsx scripts/test-autocomplete.ts
 *   ENABLE_DEBUG_LOGS=true LOG_SEARCH_DEBUG=1 npx tsx scripts/test-autocomplete.ts
 */
import { searchPlacesIndexService } from "../src/services/surfaces/search-places-index.service.js";
import { SearchAutofillService } from "../src/services/search-autofill/search-autofill.service.js";

type Case = {
  query: string;
  lat?: number;
  lng?: number;
  pass: (top: Array<{ text: string; type: string; kind: string }>) => boolean;
  label: string;
};

const eastonPa = { lat: 40.68843, lng: -75.22073 };

const CASES: Case[] = [
  {
    query: "hik",
    label: "activity: hiking in top results",
    pass: (top) => top.some((r) => r.type === "activity" && r.text.toLowerCase().includes("hiking")),
  },
  {
    query: "ski",
    label: "activity: skiing intent before place-name ski* towns",
    pass: (top) => {
      const skiIntentIdx = top.findIndex(
        (r) =>
          (r.type === "activity" && r.text.toLowerCase().includes("skiing")) ||
          (r.type === "mix" && r.text.toLowerCase().includes("skiing")),
      );
      const firstPlaceIdx = top.findIndex((r) => r.type === "town" || r.type === "state");
      return skiIntentIdx >= 0 && (firstPlaceIdx < 0 || skiIntentIdx < firstPlaceIdx);
    },
  },
  {
    query: "han",
    label: "location: Hanover-style",
    pass: (top) => top.some((r) => (r.type === "town" || r.type === "state") && r.text.toLowerCase().includes("hanover")),
  },
  {
    query: "hart",
    label: "location: Hartland/Hartford (not only Hanover)",
    pass: (top) => {
      const places = top.filter((r) => r.type === "town" || r.type === "state");
      const hasHartPlace = places.some(
        (r) => r.text.toLowerCase().includes("hartland") || r.text.toLowerCase().includes("hartford"),
      );
      const onlyHanover =
        places.length > 0 &&
        places.every((r) => r.text.toLowerCase().includes("hanover") && !r.text.toLowerCase().includes("hart"));
      return hasHartPlace && !onlyHanover;
    },
  },
  {
    query: "bur",
    lat: eastonPa.lat,
    lng: eastonPa.lng,
    label: "location: Burlington/Burke-style if in index",
    pass: (top) =>
      top.some(
        (r) =>
          (r.type === "town" || r.type === "state") &&
          (r.text.toLowerCase().includes("burlington") || r.text.toLowerCase().includes("burke")),
      ),
  },
  {
    query: "mount",
    label: "location or place-style for mount prefix",
    pass: (top) =>
      top.some((r) => {
        const t = r.text.toLowerCase();
        return (r.type === "town" || r.type === "state") && (t.includes("mount") || t.includes("mt "));
      }),
  },
  {
    query: "zzzzunlikely",
    label: "no Hanover hardcoded fallback",
    pass: (top) => !top.some((r) => r.text.toLowerCase().includes("hanover")),
  },
  {
    query: "hart",
    lat: eastonPa.lat,
    lng: eastonPa.lng,
    label: "hart + geo: not hard-filtered to Hanover only",
    pass: (top) => {
      const places = top.filter((r) => r.type === "town" || r.type === "state");
      return places.some((r) => r.text.toLowerCase().includes("hartland") || r.text.toLowerCase().includes("hartford"));
    },
  },
];

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width - 1) + "…";
  return value.padEnd(width);
}

async function main(): Promise<void> {
  console.log("Loading GeoNames places index…");
  await searchPlacesIndexService.ensureLoading();
  const diag = searchPlacesIndexService.getLoaderDiagnostics();
  console.log(
    `Index: loaded=${diag.loaded} places=${diag.places} prefixes=${diag.prefixes} loadMs=${diag.lastLoadTotalMs}`,
  );
  if (!diag.loaded) {
    console.error("Places index failed to load:", diag.loadError);
    process.exit(1);
  }

  const service = new SearchAutofillService();
  const col = { query: 10, top: 52, type: 10, coords: 18, source: 8, result: 6 };
  const header = [
    pad("query", col.query),
    pad("top results", col.top),
    pad("type/kind", col.type),
    pad("lat/lng", col.coords),
    pad("source", col.source),
    pad("pass", col.result),
  ].join(" | ");
  console.log("\n" + header);
  console.log(header.replace(/[^|]/g, "-"));

  let failed = 0;
  for (const c of CASES) {
    const res = await service.suggest({
      query: c.query,
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      mode: "default",
    });
    const top = res.suggestions.slice(0, 6).map((s) => {
      const data = (s.data ?? {}) as Record<string, unknown>;
      const lat = data.lat;
      const lng = data.lng;
      const coords =
        typeof lat === "number" && typeof lng === "number" ? `${lat.toFixed(2)},${Number(lng).toFixed(2)}` : "—";
      return {
        text: String(s.text ?? ""),
        type: String(s.type ?? ""),
        kind: String(s.suggestionType ?? s.type ?? ""),
        coords,
        source: data.cityRegionId ? "geonames_index" : s.type === "activity" ? "activity_lane" : s.type,
      };
    });
    const ok = c.pass(top);
    if (!ok) failed += 1;
    const topSummary = top.map((r) => `${r.text} (${r.type})`).join("; ") || "(empty)";
    console.log(
      [
        pad(c.query, col.query),
        pad(topSummary, col.top),
        pad(top.map((r) => r.kind).join(","), col.type),
        pad(top.map((r) => r.coords).join("; "), col.coords),
        pad(top.map((r) => String(r.source)).join(","), col.source),
        pad(ok ? "PASS" : "FAIL", col.result),
      ].join(" | "),
    );
    if (!ok) console.log(`  ↳ expected: ${c.label}`);
  }

  console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
