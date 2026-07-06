import type { FastifyInstance } from "fastify";
import {
  DISCOVERY_QUALITY_RULES,
  DISCOVERY_SPOT_CATEGORIES,
  ListCandidatesQuerySchema,
  SeedFromChannelBodySchema,
  SetStatusBodySchema,
  undiscoveredDashboardContract,
} from "../../contracts/surfaces/undiscovered-candidate.contract.js";
import { getDiscoveryCandidateStore } from "../../admin/undiscovered/discoveryCandidateStore.js";
import {
  defaultHttpFetchers,
  getChannelAdapter,
  listChannelAdapters,
} from "../../lib/undiscovered/channels/registry.js";
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
export async function registerUndiscoveredDashboardRoutes(app: FastifyInstance): Promise<void> {
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

  app.get(`${base}/channels`, async () => {
    setRouteName(c.routeNames.channels);
    return success({
      channels: listChannelAdapters().map((a) => ({
        channel: a.channel,
        label: a.label,
        strategy: a.strategy,
        liveFetchSupported: a.liveFetchSupported,
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
    });
    const store = getDiscoveryCandidateStore();
    const result = store.upsertMany(candidates);
    return success({
      ...result,
      total: store.size(),
      channel: body.channel,
      region: body.region,
      mapped: candidates.length,
      liveFetchSupported: adapter.liveFetchSupported,
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
