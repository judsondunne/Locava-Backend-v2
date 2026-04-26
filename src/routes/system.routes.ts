import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { success } from "../lib/response.js";
import { diagnosticsStore } from "../observability/diagnostics-store.js";
import { listRoutePolicies } from "../observability/route-policies.js";
import { getCoherenceStatus } from "../runtime/coherence.js";
import { routeContracts } from "./contracts.js";

const DiagnosticsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => success({ status: "ok" }));

  app.get("/ready", async () =>
    success({
      status: "ready",
      coherence: getCoherenceStatus(app.config)
    })
  );

  app.get("/version", async () =>
    success({
      service: app.config.SERVICE_NAME,
      version: app.config.SERVICE_VERSION,
      env: app.config.NODE_ENV
    })
  );

  app.get("/diagnostics", async (request) => {
    const query = DiagnosticsQuerySchema.parse(request.query);
    const operationalSignals = diagnosticsStore.getOperationalSignals(query.limit);
    const coherence = getCoherenceStatus(app.config);
    return success({
      summary: diagnosticsStore.getSummary(),
      operationalSignals,
      routeAggregates: diagnosticsStore.getRouteAggregates(query.limit),
      recentRequests: diagnosticsStore.getRecentRequests(query.limit),
      routePolicies: listRoutePolicies(),
      env: {
        nodeEnv: app.config.NODE_ENV,
        service: app.config.SERVICE_NAME,
        version: app.config.SERVICE_VERSION
      },
      coherence,
      alerts: [...operationalSignals.alerts, ...(coherence.warning ? ["process_local_coherence_mode"] : [])]
    });
  });

  app.get("/routes", async () => success({ routes: routeContracts }));

  app.get("/openapi.json", async () =>
    success({
      openapi: "3.1.0",
      info: {
        title: "Locava Backend V2",
        version: app.config.SERVICE_VERSION
      },
      paths: Object.fromEntries(
        routeContracts.map((contract) => [
          contract.path,
          {
            [contract.method.toLowerCase()]: {
              description: contract.description,
              tags: contract.tags,
              ...(contract.querySchema ? { "x-query-schema": contract.querySchema } : {}),
              ...(contract.bodySchema ? { "x-body-schema": contract.bodySchema } : {})
            }
          }
        ])
      )
    })
  );
}
