import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import {
  DISCOVERY_QUALITY_RULES,
  DISCOVERY_SPOT_CATEGORIES,
  ListCandidatesQuerySchema,
  RankSpotsBodySchema,
  SeedFromChannelBodySchema,
  SetStatusBodySchema,
  undiscoveredDashboardContract,
} from "../../contracts/surfaces/undiscovered-candidate.contract.js";
import {
  buildDefaultWebSearchFetcher,
  rankCandidate,
} from "../../lib/undiscovered/spotRanking.js";
import { getDiscoveryCandidateStore } from "../../admin/undiscovered/discoveryCandidateStore.js";
import {
  defaultHttpFetchers,
  getChannelAdapter,
  listChannelAdapters,
} from "../../lib/undiscovered/channels/registry.js";
import {
  getPbfV2FullRunStatus,
  startPbfV2FullRun,
} from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2FullRunService.js";
import { listPbfV2FullRuns } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2FullRunStore.js";
import { scanPbfViewportPreview } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2ViewportPreview.js";
import { searchPlaceImages } from "../../lib/places/searchPlaceImages.service.js";
import { applyPixelQualityChecks } from "../../lib/pbf/pixelPhotoChecks.js";
import { runPbfCopierV2Pipeline } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierV2Pipeline.js";

const VERMONT_PBF_PATH = "data/osm/vermont-latest.osm.pbf";

const ScanAreaBodySchema = z.object({
  bbox: z.object({
    westLng: z.number(),
    southLat: z.number(),
    eastLng: z.number(),
    northLat: z.number(),
  }),
  maxRawObjectsScanned: z.number().int().positive().max(2_000_000).optional(),
});

/** Summarize the most recent PBF full-run for the live scraping metrics. */
async function latestPbfRunSummary() {
  const runs = await listPbfV2FullRuns();
  if (!runs || runs.length === 0) return null;
  const latest = [...runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
  if (!latest) return null;
  const status = await getPbfV2FullRunStatus(latest.runId);
  const r = status.run;
  if (!r) return null;
  const wr = status.writeReadyCounts ?? { spots: 0, routes: 0 };
  return {
    runId: r.runId,
    status: r.status,
    mode: r.mode,
    phase: r.phase,
    percentComplete: r.percentComplete,
    processedObjects: r.processedObjects,
    avgObjectsPerSec: Math.round(r.avgObjectsPerSec ?? 0),
    currentChunkIndex: r.currentChunkIndex,
    totalChunks: r.totalChunks,
    etaMs: r.etaMs,
    acceptedSpots: wr.spots ?? 0,
    acceptedRoutes: wr.routes ?? 0,
    acceptedTotal: (wr.spots ?? 0) + (wr.routes ?? 0),
  };
}
import { buildVermontSampleCandidates } from "../../lib/undiscovered/vermontSampleCandidates.js";
import { pbfPreviewToDiscoveryCandidate } from "../../lib/undiscovered/pbfPreviewToDiscoveryCandidate.js";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";

const c = undiscoveredDashboardContract;

/**
 * Undiscovered Spots Dashboard v1 — JSON API.
 *
 * Review-queue only. This never writes `unexploredSpots`/`unexploredRoutes` or
 * `/posts`; the actual gated write stays in the PBF copier v2 pipeline. The
 * dashboard manages the candidate → reviewed → approved → written workflow.
 */
export async function registerUndiscoveredDashboardRoutes(
  app: FastifyInstance,
  env: AppEnv,
): Promise<void> {
  const base = c.apiBase;

  app.get(`${base}/health`, async () => {
    setRouteName(c.routeNames.health);
    const store = getDiscoveryCandidateStore();
    return success({
      ok: true,
      pagePath: c.pagePath,
      apiBase: base,
      totalCandidates: store.size(),
      regions: Array.from(new Set(store.list().map((x) => x.region))),
    });
  });

  app.get(`${base}/categories`, async () => {
    setRouteName(c.routeNames.categories);
    return success({
      categories: DISCOVERY_SPOT_CATEGORIES,
      qualityRules: DISCOVERY_QUALITY_RULES,
    });
  });

  app.get(`${base}/candidates`, async (request) => {
    setRouteName(c.routeNames.listCandidates);
    const q = ListCandidatesQuerySchema.parse(request.query ?? {});
    const store = getDiscoveryCandidateStore();
    const items = store.list(q);
    return success({
      items,
      total: items.length,
      counts: store.counts({ region: q.region, channel: q.channel, category: q.category }),
      countsByCategory: store.countsByCategory({ region: q.region, channel: q.channel }),
      filter: q,
    });
  });

  app.post(`${base}/candidates/:id/status`, async (request, reply) => {
    setRouteName(c.routeNames.setStatus);
    const id = (request.params as { id: string }).id;
    const body = SetStatusBodySchema.parse(request.body ?? {});
    const store = getDiscoveryCandidateStore();
    const result = store.setStatus(id, body.status, {
      reviewNotes: body.reviewNotes,
      reviewedBy: body.reviewedBy,
    });
    if (!result.ok) {
      const code = result.code === "not_found" ? 404 : 409;
      return reply.status(code).send(failure(result.code, result.message));
    }
    return success({ candidate: result.candidate });
  });

  // Local/dev seed so the review workflow is usable without a Vermont .osm.pbf.
  app.post(`${base}/seed-sample`, async () => {
    setRouteName(c.routeNames.seedSample);
    const store = getDiscoveryCandidateStore();
    const result = store.upsertMany(buildVermontSampleCandidates());
    return success({ ...result, total: store.size(), region: "VT" });
  });

  // Unified live scraping metrics: PBF engine run + all channels + grand total.
  app.get(`${base}/scrape-metrics`, async () => {
    setRouteName("admin.undiscovered.dashboard_v1.scrape_metrics");
    const store = getDiscoveryCandidateStore();
    const all = store.list();
    const byChannel: Record<string, number> = {};
    for (const c of all) byChannel[c.sourceChannel] = (byChannel[c.sourceChannel] ?? 0) + 1;
    const pbf = await latestPbfRunSummary();
    const channelCandidates = all.length;
    const pbfAccepted = pbf?.acceptedTotal ?? 0;
    return success({
      pbf,
      channels: byChannel,
      totals: {
        channelCandidates,
        pbfAccepted,
        grandTotal: channelCandidates + pbfAccepted,
      },
      statusCounts: store.counts(),
    });
  });

  // One-click: start a dry-run PBF scan of the bundled Vermont extract (no prod writes).
  app.post(`${base}/pbf/start-vermont`, async (request, reply) => {
    setRouteName("admin.undiscovered.dashboard_v1.pbf_start_vermont");
    try {
      const run = await startPbfV2FullRun({ pbfPath: VERMONT_PBF_PATH, mode: "dry_run" });
      return success({ runId: run.runId, status: run.status, mode: run.mode, totalChunks: run.totalChunks, postsWriteForbidden: true as const });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("pbf_start_failed", message));
    }
  });

  // Pull the latest PBF run's accepted locations into the reviewable queue so
  // they can be sifted + actioned alongside channel candidates.
  app.post(`${base}/pbf/import-results`, async (request, reply) => {
    setRouteName("admin.undiscovered.dashboard_v1.pbf_import_results");
    const runs = await listPbfV2FullRuns();
    if (!runs || runs.length === 0) {
      return reply.status(404).send(failure("no_pbf_run", "No PBF run to import — start a scan first."));
    }
    const latest = [...runs].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
    const status = await getPbfV2FullRunStatus(latest!.runId);
    const samples = status.categorySamples ?? {};
    const docs: PbfCopierPreviewDoc[] = [];
    for (const list of Object.values(samples)) docs.push(...(list ?? []));
    // Skip low-signal accepted docs whose display name is a raw OSM tag (e.g. "barrier=yes").
    const named = docs.filter((d) => d.displayName && !d.displayName.includes("="));
    const candidates = named.map((d) => pbfPreviewToDiscoveryCandidate(d, { region: "VT" }));
    const store = getDiscoveryCandidateStore();
    const result = store.upsertMany(candidates);
    return success({ ...result, imported: candidates.length, total: store.size(), runId: latest!.runId });
  });

  // Browse-by-area: scan the Vermont PBF for the map's current viewport (same
  // engine + quality pipeline as the PBF Copier V2 dashboard) and load the real,
  // coordinated spots into the reviewable/mappable queue.
  app.post(`${base}/pbf/scan-area`, async (request, reply) => {
    setRouteName("admin.undiscovered.dashboard_v1.pbf_scan_area");
    const body = ScanAreaBodySchema.parse(request.body ?? {});
    try {
      const scan = await scanPbfViewportPreview({
        pbfPath: VERMONT_PBF_PATH,
        bbox: body.bbox,
        mode: "raw_osm",
        maxRawObjectsScanned: body.maxRawObjectsScanned,
      });
      const filtered = runPbfCopierV2Pipeline({ rawItems: scan.items });
      // Keep only quality-passing items with a real name (drop raw-tag junk).
      const visible = filtered.items.filter(
        (i) => !i.filteredOut && i.displayName && !i.displayName.includes("="),
      );
      const candidates = visible.map((d) => pbfPreviewToDiscoveryCandidate(d, { region: "VT" }));
      const store = getDiscoveryCandidateStore();
      const result = store.upsertMany(candidates);
      return success({
        ...result,
        scanned: scan.items.length,
        visible: visible.length,
        imported: candidates.length,
        total: store.size(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes(":") ? message.split(":")[0]! : "scan_area_failed";
      return reply.status(400).send(failure(code, message));
    }
  });

  // Candid photo search for any typed location. Reuses the existing heuristic
  // image pipeline (Serper = Google Images → Bing fallback; ranking drops
  // logos/maps/stock-looking results). Live results need SERPER_API_KEY or
  // BING_SEARCH_API_KEY; without keys a small mock set answers known demo names.
  app.post(`${base}/photo-search`, async (request, reply) => {
    setRouteName("admin.undiscovered.dashboard_v1.photo_search");
    const body = z
      .object({ query: z.string().min(2).max(200), limit: z.number().int().min(1).max(24).optional() })
      .parse(request.body ?? {});
    try {
      const { results, source } = await searchPlaceImages(body.query, env, {
        resultLimit: body.limit ?? 12,
        skipLoadVerification: true,
      });
      // Pixel-level pass: decode actual image bytes to drop true B&W photos and
      // OCR the top results to drop images with rendered text. Best-effort.
      const pixel = await applyPixelQualityChecks(results, { maxImages: 10, maxOcr: 4 });
      const hasKeys = Boolean(
        String(env.SERPER_API_KEY ?? "").trim() || String(env.BING_SEARCH_API_KEY ?? "").trim(),
      );
      const note = !hasKeys
        ? "No image-search API key set — showing mock results for known demo names only. Add SERPER_API_KEY (Google Images via serper.dev) or BING_SEARCH_API_KEY to .env for live search."
        : undefined;
      return success({
        query: body.query,
        source,
        count: pixel.kept.length,
        results: pixel.kept,
        pixelChecks: {
          analyzed: pixel.analyzed,
          ocrRan: pixel.ocrRan,
          unverified: pixel.unverified,
          rejected: pixel.rejected.map((r) => ({
            imageUrl: r.result.imageUrl,
            sourceDomain: r.result.sourceDomain,
            reasons: r.rejectReasons,
            textSample: r.analysis.textSample,
            meanSaturation: r.analysis.meanSaturation,
          })),
        },
        note,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send(failure("photo_search_failed", message));
    }
  });

  // Popularity ranking on top of the quality filter (no AI): local metadata
  // signals for all matching spots, authority-weighted Google hits for up to
  // `limit` of them (1 Serper credit each, cached per name).
  app.post(`${base}/rank-spots`, async (request) => {
    setRouteName("admin.undiscovered.dashboard_v1.rank_spots");
    const body = RankSpotsBodySchema.parse(request.body ?? {});
    const store = getDiscoveryCandidateStore();
    const fetcher = buildDefaultWebSearchFetcher(env);
    const pool = store
      .list({ channel: body.channel, category: body.category })
      .filter((cand) => cand.qualityGate.passed)
      .filter((cand) => (body.onlyUnranked ? cand.ranking?.webAuthority === undefined : true));

    let creditsSpent = 0;
    let webRanked = 0;
    let localRanked = 0;
    const tiers: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i]!;
      const useWeb = fetcher && i < body.limit;
      const r = await rankCandidate(cand, { fetcher: useWeb ? fetcher : null, region: cand.region });
      store.setRanking(cand.id, r.ranking);
      if (r.spentCredit) creditsSpent += 1;
      if (r.usedWeb) webRanked += 1;
      else localRanked += 1;
      tiers[r.ranking.tier] = (tiers[r.ranking.tier] ?? 0) + 1;
    }

    const top = store
      .list({ channel: body.channel, category: body.category })
      .filter((cand) => cand.ranking)
      .slice(0, 5)
      .map((cand) => ({
        name: cand.displayName,
        score: cand.ranking!.score,
        tier: cand.ranking!.tier,
        webAuthority: cand.ranking!.webAuthority,
        hiddenGem: cand.ranking!.hiddenGem ?? false,
        signals: cand.ranking!.signals.slice(0, 6),
      }));

    return success({
      considered: pool.length,
      webRanked,
      localRanked,
      creditsSpent,
      tiers,
      top,
      webSearchAvailable: Boolean(fetcher),
    });
  });

  app.get(`${base}/channels`, async () => {
    setRouteName(c.routeNames.channels);
    const redditAuthed = Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET);
    return success({
      channels: listChannelAdapters().map((a) => ({
        channel: a.channel,
        label: a.label,
        strategy: a.strategy,
        // Reddit's live path is only usable once OAuth creds are configured.
        liveFetchSupported: a.channel === "reddit" ? redditAuthed : a.liveFetchSupported,
        needsCredentials: a.channel === "reddit" && !redditAuthed,
      })),
    });
  });

  // Multi-channel seam: run a channel adapter and map its output into the review queue.
  app.post(`${base}/seed-from-channel`, async (request, reply) => {
    setRouteName(c.routeNames.seedFromChannel);
    const body = SeedFromChannelBodySchema.parse(request.body ?? {});
    const adapter = getChannelAdapter(body.channel);
    if (!adapter) {
      return reply.status(404).send(failure("unknown_channel", `No adapter for ${body.channel}`));
    }
    const candidates = await adapter.fetchCandidates({
      region: body.region,
      query: body.query,
      limit: body.limit,
      rawItems: body.rawItems,
      httpGetJson: defaultHttpFetchers.httpGetJson,
      httpGetText: defaultHttpFetchers.httpGetText,
      redditCreds: {
        clientId: env.REDDIT_CLIENT_ID,
        clientSecret: env.REDDIT_CLIENT_SECRET,
        userAgent: env.REDDIT_USER_AGENT,
      },
    });
    const store = getDiscoveryCandidateStore();
    const result = store.upsertMany(candidates);

    // Actionable feedback so a 0-result never looks like a silent failure.
    let note: string | undefined;
    if (candidates.length === 0) {
      const redditAuthed = Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET);
      if (body.channel === "reddit" && !redditAuthed) {
        note = "Reddit needs API credentials — set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env, then restart.";
      } else if (body.channel === "instagram") {
        note = "Instagram has no open search API — paste captions/geotags (rawItems), or configure the Graph API.";
      } else if (body.channel === "trail_db") {
        note = "Trail sources need structured items (name + coords) via rawItems, or a trail API key.";
      } else if (body.channel === "web_blog") {
        note = "No place names found. Enter a Vermont page URL (or comma-separated URLs); left blank, it scrapes curated Vermont pages.";
      } else {
        note = "No candidates produced for this input.";
      }
    }

    return success({
      ...result,
      total: store.size(),
      channel: body.channel,
      region: body.region,
      mapped: candidates.length,
      liveFetchSupported: adapter.liveFetchSupported,
      note,
    });
  });

  // Real seam: accept OSM PBF v2 preview docs and map them into the review queue.
  app.post(`${base}/seed-from-pbf`, async (request) => {
    setRouteName(c.routeNames.seedFromPbf);
    const body = (request.body ?? {}) as { region?: string; previewDocs?: PbfCopierPreviewDoc[] };
    const region = body.region ?? "VT";
    const docs = Array.isArray(body.previewDocs) ? body.previewDocs : [];
    const candidates = docs.map((d) => pbfPreviewToDiscoveryCandidate(d, { region }));
    const store = getDiscoveryCandidateStore();
    const result = store.upsertMany(candidates);
    return success({ ...result, total: store.size(), region, mapped: candidates.length });
  });
}
