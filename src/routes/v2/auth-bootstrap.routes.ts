import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { authSessionContract, AuthSessionQuerySchema } from "../../contracts/surfaces/auth-session.contract.js";
import { bootstrapContract, BootstrapQuerySchema } from "../../contracts/surfaces/bootstrap.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { AuthBootstrapRepository } from "../../repositories/surfaces/auth-bootstrap.repository.js";
import { AuthBootstrapService } from "../../services/surfaces/auth-bootstrap.service.js";
import { AuthSessionOrchestrator } from "../../orchestration/surfaces/auth-session.orchestrator.js";
import { BootstrapOrchestrator } from "../../orchestration/surfaces/bootstrap.orchestrator.js";
import { canUseV2Surface } from "../../flags/cutover.js";

export async function registerV2AuthBootstrapRoutes(app: FastifyInstance): Promise<void> {
  const repository = new AuthBootstrapRepository();
  const service = new AuthBootstrapService(repository);
  const authSessionOrchestrator = new AuthSessionOrchestrator(service);
  const bootstrapOrchestrator = new BootstrapOrchestrator(service);

  app.get(authSessionContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("auth", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Auth v2 surface is not enabled for this viewer"));
    }

    const query = AuthSessionQuerySchema.parse(request.query);
    setRouteName(authSessionContract.routeName);

    const payload = await authSessionOrchestrator.run(viewer, query.debugSlowDeferredMs);
    return success(payload);
  });

  app.get(bootstrapContract.path, async (request, reply) => {
    const viewer = buildViewerContext(request);
    if (!canUseV2Surface("bootstrap", viewer.roles)) {
      return reply.status(403).send(failure("v2_surface_disabled", "Bootstrap v2 surface is not enabled for this viewer"));
    }

    const query = BootstrapQuerySchema.parse(request.query);
    setRouteName(bootstrapContract.routeName);

    const payload = await bootstrapOrchestrator.run(viewer, query.debugSlowDeferredMs);
    return success(payload);
  });
}
