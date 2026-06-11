#!/usr/bin/env tsx
/**
 * One-off debug: compare Serper raw vs pipeline vs curation for a single place.
 * Usage: npx tsx scripts/debug-sucker-pond-photo-search.mts
 */
import { config as loadEnv } from "dotenv";
loadEnv();

import { curatePlaceImageSearchResults } from "../src/lib/pbf/curatePlaceImageSearchResults.js";
import { classifyDiscussionOrForumResult } from "../src/lib/pbf/detectDiscussionOrForumResult.js";
import { filterAcceptablePlaceImages, classifyPlaceImageQuality } from "../src/lib/places/placeImageQualityFilter.js";
import { filterRelevantPlaceImages } from "../src/lib/places/placeImageRanking.js";
import {
  buildPlaceQuery,
  parsePlaceQueries,
  searchPlaceImages,
} from "../src/lib/places/searchPlaceImages.service.js";
import type { AppEnv } from "../src/config/env.js";
import { deriveTargetPlaceIdentityFromParsedQuery } from "../src/lib/pbf/deriveTargetPlaceIdentity.js";
import { scorePhotoResultMetadata } from "../src/lib/pbf/scorePhotoResultMetadata.js";

const PLACE = "Sucker Pond, Bennington, Vermont";

async function fetchSerperRaw(searchQuery: string, apiKey: string): Promise<PlaceImageResult[]> {
  const negatives = ["-forum", "-thread", "-reddit", "-tacomaworld", "-quora"];
  const withPhoto = /\bphoto(s|graphy)?\b/i.test(searchQuery) ? searchQuery : `${searchQuery} photo`;
  const q = `${withPhoto} ${negatives.join(" ")}`.trim();

  const response = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q, num: 30 }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Serper ${response.status}`);
  const data = (await response.json()) as {
    images?: Array<{
      title?: string;
      imageUrl?: string;
      link?: string;
      source?: string;
      imageWidth?: number;
      imageHeight?: number;
    }>;
  };
  return (data.images ?? [])
    .filter((item) => item.imageUrl)
    .map((item, index) => ({
      id: `raw-${index + 1}`,
      imageUrl: item.imageUrl!,
      caption: item.title?.trim() || "",
      title: item.title?.trim(),
      sourceName: item.source?.trim() || "web",
      sourceUrl: item.link || item.imageUrl!,
      imageWidth: item.imageWidth,
      imageHeight: item.imageHeight,
    }));
}

function summarizeRow(label: string, rows: PlaceImageResult[]) {
  console.log(`\n=== ${label} (${rows.length}) ===`);
  for (const row of rows.slice(0, 12)) {
    const forum = classifyDiscussionOrForumResult(row);
    const quality = classifyPlaceImageQuality(row);
    console.log({
      title: (row.title || row.caption || "").slice(0, 90),
      sourceUrl: row.sourceUrl.slice(0, 100),
      imageUrl: row.imageUrl.slice(0, 90),
      forum: forum.isForum ? forum.reason : null,
      quality: quality.acceptable ? "ok" : quality.reason,
      dims: row.imageWidth && row.imageHeight ? `${row.imageWidth}x${row.imageHeight}` : "?",
    });
  }
}

async function main() {
  const env = process.env as unknown as AppEnv;
  const apiKey = String(env.SERPER_API_KEY ?? "").trim();
  if (!apiKey) {
    console.error("SERPER_API_KEY missing");
    process.exit(1);
  }

  const query = buildPlaceQuery(PLACE);
  console.log("Query:", query);

  const raw = await fetchSerperRaw(query.searchQuery, apiKey);
  summarizeRow("Serper raw (enhanced query)", raw);

  const relevant = filterRelevantPlaceImages(raw, query);
  summarizeRow("After relevance filter", relevant);

  const { results, source } = await searchPlaceImages(query, env, { resultLimit: 12 });
  summarizeRow(`Pipeline output (${source})`, results);
  const identity = deriveTargetPlaceIdentityFromParsedQuery(query);
  for (const row of results) {
    const meta = scorePhotoResultMetadata(identity, row, { scoringProfile: "undiscovered_app" });
    console.log("SCORE:", {
      title: (row.title || row.caption || "").slice(0, 85),
      hardReject: meta.hardReject,
      confidence: meta.confidence,
      score: meta.score,
      reject: meta.rejectReasons,
      positive: meta.positiveReasons,
      imageUrl: row.imageUrl.slice(0, 95),
    });
  }

  // Stage-by-stage trace
  const rawAll = await fetchSerperRaw(query.searchQuery, apiKey);
  const rel = filterRelevantPlaceImages(rawAll, query);
  const acc = filterAcceptablePlaceImages(rel);
  console.log("\n=== Stage counts ===", { raw: rawAll.length, relevant: rel.length, acceptable: acc.length });
  for (const row of rawAll.filter((r) => (r.sourceUrl || "").includes("geocities"))) {
    const { scoreLocationRelevance } = await import("../src/lib/places/placeImageRanking.js");
    const { verifyImageLoads } = await import("../src/lib/places/placeImageEmbedPolicy.js");
    const relScore = scoreLocationRelevance(row, query);
    const probe = await verifyImageLoads(row.imageUrl);
    console.log("geocities row:", {
      title: row.title,
      relScore,
      loadOk: probe.ok,
      imageUrl: row.imageUrl,
    });
  }

  const scored = curatePlaceImageSearchResults(query, results, {
    scoringProfile: "undiscovered_app",
    strictTitleSourceMatch: false,
  });

  console.log("\n=== Curation (undiscovered_app) ===");
  console.log({
    assetStatus: scored.assetStatus,
    assetsReady: scored.assetsReady,
    accepted: scored.acceptedAssets.length,
    rejected: scored.rejectedCount,
    resultSetScore: scored.resultSetScore,
    topRejectionReasons: scored.topRejectionReasons,
  });
  for (const asset of scored.acceptedAssets) {
    console.log("ACCEPTED:", {
      title: asset.title?.slice(0, 90),
      sourceUrl: asset.sourceUrl,
      imageUrl: asset.imageUrl,
      score: asset.assetMatchScore,
      confidence: asset.assetMatchConfidence,
    });
  }

  // HTTP API test
  try {
    const res = await fetch("http://127.0.0.1:8080/api/places/search-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        placeName: PLACE,
        scoringProfile: "undiscovered_app",
        strictTitleSourceMatch: false,
      }),
    });
    const payload = await res.json();
    console.log("\n=== HTTP API ===");
    console.log({ status: res.status, ok: payload.ok, accepted: payload.results?.length ?? 0 });
    for (const row of payload.results ?? []) {
      console.log("API:", {
        title: (row.title || row.caption || "").slice(0, 90),
        sourceUrl: row.sourceUrl,
        imageUrl: row.imageUrl,
      });
    }
    if (payload.curation) {
      console.log("curation:", {
        assetStatus: payload.curation.assetStatus,
        assetsReady: payload.curation.assetsReady,
        rawResultCount: payload.curation.rawResultCount,
        topRejectionReasons: payload.curation.topRejectionReasons,
      });
    }
  } catch (error) {
    console.log("\nHTTP API skipped:", error instanceof Error ? error.message : error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
