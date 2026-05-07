import type { FastifyInstance } from "fastify";
import { ProfileBootstrapOrchestrator } from "../../orchestration/surfaces/profile-bootstrap.orchestrator.js";
import { ProfileRepository } from "../../repositories/surfaces/profile.repository.js";
import { ProfileService } from "../../services/surfaces/profile.service.js";
import { buildCompatMergedViewerContext } from "./compat-viewer-context.js";
import { buildProductCompatViewer } from "./compat-viewer-payload.js";
import {
  mapV2ProfileBootstrapToProductApi,
  profileHeaderToSessionViewer
} from "./legacy-product-bootstrap.js";
import { resolveCompatViewerId } from "./resolve-compat-viewer-id.js";

const profileRepository = new ProfileRepository();
const profileService = new ProfileService(profileRepository);
const profileBootstrapOrchestrator = new ProfileBootstrapOrchestrator(profileService);

export async function registerLegacyBootstrapCompatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/product/session/bootstrap", async (request) => {
    const viewerId = resolveCompatViewerId(request);
    let viewer = buildProductCompatViewer(viewerId);
    if (viewerId !== "anonymous") {
      const header = await profileRepository.getProfileHeader(viewerId);
      viewer = profileHeaderToSessionViewer(header);
      if (!viewer.handle || !viewer.name) {
        throw new Error("/api/v1/product/session/bootstrap: missing canonical profile identity");
      }
    }
    return {
      success: true,
      viewer,
      viewerEtag: `viewer:${viewerId}:v2:${viewer.handle}`,
      user: {
        uid: viewerId,
        displayName: viewer.name,
        onboardingComplete: true
      },
      session: {
        serverTs: Date.now(),
        coldStartEstimate: false
      }
    };
  });

  app.get("/api/v1/product/profile/bootstrap", async (request) => {
    const viewerId = resolveCompatViewerId(request);
    const viewerCtx = buildCompatMergedViewerContext(request);

    if (viewerId === "anonymous") {
      return {
        viewer: buildProductCompatViewer(viewerId),
        counts: { posts: 0, followers: 0, following: 0 },
        grid: { items: [], nextCursor: null },
        serverTsMs: Date.now(),
        etagSeed: `profile:${viewerId}:anon`
      };
    }

    const q = request.query as Record<string, string | undefined>;
    const limitRaw = Math.min(60, Math.max(1, Number(q.limit) || 30));
    const gridLimit = Math.min(18, Math.max(6, limitRaw));

    const v2 = await profileBootstrapOrchestrator.run({
      viewer: viewerCtx,
      userId: viewerId,
      gridLimit,
      includeTabPreviews: true,
      debugSlowDeferredMs: 0
    });

    return mapV2ProfileBootstrapToProductApi(v2, viewerId);
  });
}
