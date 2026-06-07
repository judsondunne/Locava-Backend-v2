import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import type { BatchSummary, PlaceQaResult, ProductionVerdict, RunState } from "./types.js";
import { computeHitRates, computeProductionVerdict } from "./scoring.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderImageCard(place: PlaceQaResult, imageIndex: number): string {
  const img = place.images[imageIndex]!;
  const vision = img.vision;
  return `
    <article class="card" data-place="${escapeHtml(place.seedId)}" data-image="${imageIndex}">
      <img src="${escapeHtml(img.imageUrl)}" alt="${escapeHtml(place.placeName)}" loading="lazy" />
      <div class="meta">
        <div><strong>Load:</strong> ${img.loadsOk ? "OK" : "FAIL"} (${img.loadMs}ms)</div>
        <div><strong>Caption:</strong> ${escapeHtml(img.caption || "")}</div>
        <div><strong>Source page:</strong> <a href="${escapeHtml(img.sourceUrl || img.backlinkUrl || "#")}">${escapeHtml(img.sourceName || "")}</a></div>
        <div><strong>Domain:</strong> ${escapeHtml(img.sourceDomain || "")}</div>
        <div><strong>Provider:</strong> ${escapeHtml(img.provider || place.provider)}</div>
        <div><strong>License:</strong> ${escapeHtml(img.licenseNote || "")}</div>
        <div><strong>Disclaimer:</strong> ${escapeHtml(img.copyrightDisclaimer || "")}</div>
        <div><strong>Label:</strong> ${escapeHtml(img.placeLabel)}</div>
        ${vision ? `
          <div><strong>Place match:</strong> ${vision.placeMatchScore}/5</div>
          <div><strong>Visual quality:</strong> ${vision.visualQualityScore}/5</div>
          <div><strong>Locava coolness:</strong> ${vision.locavaCoolnessScore}/5</div>
          <div><strong>Risk:</strong> ${vision.wrongPlaceRisk}</div>
          <div><strong>Reason:</strong> ${escapeHtml(vision.shortReason)}</div>
        ` : `<div><em>Vision not automated — use buttons below.</em></div>`}
        <div class="review-buttons">
          <button type="button" data-verdict="likely_correct">Likely correct</button>
          <button type="button" data-verdict="unsure">Unsure</button>
          <button type="button" data-verdict="wrong">Wrong</button>
        </div>
        ${img.failureReasons.length ? `<div class="fail">${escapeHtml(img.failureReasons.join(", "))}</div>` : ""}
      </div>
    </article>`;
}

export function renderHtmlReport(state: RunState): string {
  const verdict = computeProductionVerdict(state.places, state.batches);
  const hitRates = computeHitRates(state.places, state.minImages);

  const placeSections = state.places
    .map((place) => {
      const cards = place.images.map((_, idx) => renderImageCard(place, idx)).join("\n");
      return `
      <section class="place" id="${escapeHtml(place.seedId)}">
        <header>
          <h2>${escapeHtml(place.placeName)} — ${escapeHtml(place.town)}, ${escapeHtml(place.state)}</h2>
          <p><strong>Query:</strong> ${escapeHtml(place.apiPlaceQuery)}</p>
          <p><strong>Search query used:</strong> ${escapeHtml(place.searchQueryUsed)}</p>
          <p><strong>Provider:</strong> ${escapeHtml(place.provider)} | <strong>Status:</strong> ${escapeHtml(place.passFail)}</p>
          <p><strong>Failures:</strong> ${escapeHtml(place.failureReasons.join(", ") || "none")}</p>
        </header>
        <div class="grid">${cards || "<p>No images returned.</p>"}</div>
      </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Locava Photo Search QA — ${escapeHtml(state.runId)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0b1220; color: #e5e7eb; }
    header.page { padding: 20px; background: #111827; border-bottom: 1px solid #374151; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .place { padding: 20px; border-bottom: 1px solid #1f2937; }
    .card { background: #111827; border: 1px solid #374151; border-radius: 12px; overflow: hidden; }
    .card img { width: 100%; aspect-ratio: 4/3; object-fit: cover; background: #000; }
    .meta { padding: 12px; font-size: 13px; line-height: 1.45; word-break: break-word; }
    .fail { color: #fca5a5; margin-top: 8px; }
    .review-buttons { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    button { background: #1d4ed8; color: white; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    button[data-verdict="wrong"] { background: #b91c1c; }
    button[data-verdict="unsure"] { background: #a16207; }
    .summary { padding: 20px; }
    code { background: #1f2937; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <header class="page">
    <h1>Locava Photo Search QA</h1>
    <p>Run <code>${escapeHtml(state.runId)}</code> | Target <code>${escapeHtml(state.target)}</code> | Vision <code>${escapeHtml(state.visionMode)}</code></p>
    <p><strong>Verdict:</strong> ${escapeHtml(verdict)}</p>
    <p>Hit rates — ≥${state.minImages} valid images: ${hitRates.placesWithMinValidImagesPct}% | all load: ${hitRates.allImagesLoadPct}% | high-confidence match: ${hitRates.highConfidencePlaceMatchPct}%</p>
  </header>
  <div class="summary">
    <p>Estimated provider calls: ${state.estimatedProviderCalls} | Estimated credits: ${state.estimatedCredits} (exact cost unknown unless provider headers captured)</p>
  </div>
  ${placeSections}
  <script>
    document.querySelectorAll('.review-buttons button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.card');
        if (!card) return;
        const label = card.querySelector('.meta');
        const existing = label.querySelector('.manual-verdict');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.className = 'manual-verdict';
        div.innerHTML = '<strong>Manual verdict:</strong> ' + btn.dataset.verdict;
        label.appendChild(div);
      });
    });
  </script>
</body>
</html>`;
}

export function renderMarkdownSummary(state: RunState, batch?: BatchSummary): string {
  const verdict = computeProductionVerdict(state.places, state.batches);
  const hitRates = computeHitRates(state.places, state.minImages);
  const lines: string[] = [
    `# Locava Photo Search QA Summary`,
    "",
    `- Run ID: \`${state.runId}\``,
    `- Target: \`${state.target}\` (\`${state.baseUrl}\`)`,
    `- Vision: \`${state.visionMode}\`${state.visionModel ? ` (${state.visionModel})` : ""}`,
    `- Places completed: ${state.places.length}`,
    `- Estimated provider calls: ${state.estimatedProviderCalls}`,
    `- Estimated credits: ${state.estimatedCredits} (exact cost unknown)`,
    "",
    "## Hit rates",
    `- Places with ≥${state.minImages} valid images: **${hitRates.placesWithMinValidImagesPct}%**`,
    `- Places with all images loading: **${hitRates.allImagesLoadPct}%**`,
    `- High-confidence place match: **${hitRates.highConfidencePlaceMatchPct}%**`,
    "",
    `## Verdict: **${verdict}**`,
    "",
  ];

  if (batch) {
    lines.push(
      `## Batch ${batch.batchNumber}`,
      `- Passed: ${batch.passed}`,
      `- Manual review: ${batch.manualReview}`,
      `- Failed: ${batch.failed}`,
      `- Valid images: ${batch.validImages}/${batch.totalImagesReturned}`,
      `- Broken images: ${batch.brokenImages}`,
      `- Missing metadata: ${batch.missingMetadata}`,
      `- Duplicate rate: ${(batch.duplicateRate * 100).toFixed(1)}%`,
      `- Avg response: ${batch.avgResponseMs}ms | p95: ${batch.p95ResponseMs}ms`,
      `- Top failures: ${batch.topFailureReasons.join("; ") || "none"}`,
      `- Worst: ${batch.worstPlaces.join(", ") || "n/a"}`,
      `- Best: ${batch.bestPlaces.join(", ") || "n/a"}`,
      "",
    );
  }

  for (const place of state.places) {
    lines.push(
      `### ${place.placeName} (${place.town}, ${place.state}) — ${place.passFail}`,
      `- Results: ${place.totalResults}, valid: ${place.validImageCount}, broken: ${place.brokenImageCount}`,
      `- Avg place match: ${place.avgPlaceMatchScore?.toFixed(2) ?? "n/a"}`,
      `- Failures: ${place.failureReasons.join(", ") || "none"}`,
      "",
    );
  }

  return lines.join("\n");
}

export async function writeReports(state: RunState, outDir: string, batch?: BatchSummary): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "report.json");
  const mdPath = path.join(outDir, "summary.md");
  const htmlPath = path.join(outDir, "report.html");
  const statePath = path.join(outDir, "state.json");

  await writeFile(jsonPath, JSON.stringify({ state, batch: batch ?? null }, null, 2), "utf8");
  await writeFile(mdPath, renderMarkdownSummary(state, batch), "utf8");
  await writeFile(htmlPath, renderHtmlReport(state), "utf8");
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const qaRoot = path.resolve(__dirname);
  await copyFile(htmlPath, path.join(qaRoot, "latest-report.html"));
  await copyFile(mdPath, path.join(qaRoot, "latest-summary.md"));
}

export function printBatchSummary(batch: BatchSummary): void {
  console.log(`\nBatch ${batch.batchNumber} summary:`);
  console.log(`- Places tested: ${batch.placesTested}`);
  console.log(`- Passed: ${batch.passed}`);
  console.log(`- Manual review: ${batch.manualReview}`);
  console.log(`- Failed: ${batch.failed}`);
  console.log(`- Total images returned: ${batch.totalImagesReturned}`);
  console.log(`- Valid images: ${batch.validImages}`);
  console.log(`- Broken images: ${batch.brokenImages}`);
  console.log(`- Missing metadata: ${batch.missingMetadata}`);
  console.log(`- Duplicate rate: ${(batch.duplicateRate * 100).toFixed(1)}%`);
  console.log(`- Avg response time: ${batch.avgResponseMs}ms`);
  console.log(`- p95 response time: ${batch.p95ResponseMs}ms`);
  console.log(`- Estimated provider calls: ${batch.estimatedProviderCalls}`);
  console.log(`- Estimated credits/cost: ${batch.estimatedCredits} (exact cost unknown)`);
  console.log(`- Top failure reasons: ${batch.topFailureReasons.join("; ") || "none"}`);
  console.log(`- Worst places: ${batch.worstPlaces.join(", ") || "n/a"}`);
  console.log(`- Best places: ${batch.bestPlaces.join(", ") || "n/a"}`);
  if (batch.catastrophic) {
    console.log(`- CATASTROPHIC: ${batch.catastrophicReasons.join("; ")}`);
  }
}

export function printFinalVerdict(state: RunState): ProductionVerdict {
  const verdict = computeProductionVerdict(state.places, state.batches);
  console.log(`\n================ PRODUCTION READINESS VERDICT ================`);
  console.log(verdict);
  console.log(`============================================================\n`);
  return verdict;
}
