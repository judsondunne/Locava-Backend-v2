#!/usr/bin/env tsx
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PBF_REVIEW_BASE_URL ?? "http://localhost:8080";
const preset = process.env.PBF_REVIEW_PRESET ?? "vermont_review_1000";
const outDir = process.env.PBF_REVIEW_OUT_DIR ?? path.join(process.cwd(), "tmp/pbf-copier");
const outFile = process.env.PBF_REVIEW_OUT_FILE ?? path.join(outDir, "vermont-review-1000.json");

async function main(): Promise<void> {
  const url = `${baseUrl}/api/public/pbf-copier/dry-run?preset=${encodeURIComponent(preset)}`;
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url);
  const payload = await res.json();
  if (!res.ok || !payload?.ok) {
    console.error("Dry-run failed:", JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  const data = payload.data;
  const quality = data.qualitySummary ?? data.previewQuality ?? {};
  const docs = data.previewDocs ?? [];

  console.log("\n=== PBF review summary ===");
  console.log("saved:", outFile);
  console.log("previewDocs:", docs.length);
  console.log("spots:", quality.spotsCount ?? data.counts?.spots);
  console.log("routes:", quality.routesCount ?? data.counts?.routes);
  console.log("duplicateNamesRemoved:", quality.duplicateNamesRemoved ?? 0);
  console.log("invalidActivityDocsCount:", quality.invalidActivityDocsCount ?? 0);
  console.log("invalidActivitiesFound:", (quality.invalidActivitiesFound ?? []).join(", ") || "(none)");
  console.log("rejectedByClassifier:", data.rejectedByClassifier ?? data.metrics?.rejectedByClassifier);
  console.log("acceptedBeforeCap:", data.acceptedBeforeCap);

  console.log("\nTop primary activities:");
  const primaryDist = quality.primaryActivityDistribution ?? {};
  for (const [activity, count] of Object.entries(primaryDist).slice(0, 15)) {
    console.log(`  ${activity}: ${count}`);
  }

  console.log("\nTop reject reasons:");
  for (const row of quality.topRejectReasons ?? []) {
    console.log(`  ${row.reason}: ${row.count}`);
  }

  console.log("\nSample accepted docs:");
  for (const doc of docs.slice(0, 20)) {
    const tags = Object.entries(doc.sourceTagSample ?? {})
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(
      `  - ${doc.displayName} | ${doc.primaryActivity} | [${(doc.activities ?? []).join(", ")}] | ${doc.lat?.toFixed?.(5)}, ${doc.lng?.toFixed?.(5)} | ${tags}`
    );
  }

  const dupesRemoved = quality.duplicateNamesRemoved ?? 0;
  const invalid = quality.invalidActivityDocsCount ?? 0;

  const norm = (name: string) =>
    name
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normalized = docs.map((doc: { displayName?: string }) => norm(doc.displayName ?? ""));
  const remainingDupes = normalized.filter((name: string, index: number) => name && normalized.indexOf(name) !== index);

  console.log("\nRemaining duplicate normalized names:", remainingDupes.length);
  if (remainingDupes.length > 0) {
    console.log("  examples:", [...new Set(remainingDupes)].slice(0, 10).join(", "));
  }
  console.log("Duplicates removed during finalize:", dupesRemoved);

  if (remainingDupes.length > 0 || invalid > 0) {
    console.error(`\nQuality gate failed: remainingDuplicates=${remainingDupes.length}, invalidActivityDocs=${invalid}`);
    process.exit(2);
  }

  console.log("\nQuality gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
