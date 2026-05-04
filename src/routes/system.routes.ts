import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { APPLE_OAUTH_EXCHANGE_MODES } from "../contracts/surfaces/auth-signin-apple.contract.js";
import { getFirebaseAdminDiagnostics } from "../lib/firebase-admin.js";
import { resolveFirebaseToolkitContinueUri } from "../lib/firebase-identity-toolkit.js";
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

  /**
   * Non-secret probe for auth wiring (Firebase REST + nonce path + legacy proxy toggle).
   * Does not attest that Apple/Google are enabled in Firebase Console.
   */
  app.get("/health/auth-capabilities", async () =>
    success({
      firebaseWebApiKeyConfigured:
        typeof app.config.FIREBASE_WEB_API_KEY === "string" && app.config.FIREBASE_WEB_API_KEY.trim().length > 0,
      firebaseAdminConfigured:
        (typeof app.config.FIREBASE_CLIENT_EMAIL === "string" &&
          app.config.FIREBASE_CLIENT_EMAIL.trim().length > 0 &&
          typeof app.config.FIREBASE_PRIVATE_KEY === "string" &&
          app.config.FIREBASE_PRIVATE_KEY.trim().length > 0) ||
        Boolean(getFirebaseAdminDiagnostics().clientEmailPresent),
      backendAppleRouteDetected: true,
      backendGoogleRouteDetected: true,
      legacyProxyBaseConfigured:
        typeof app.config.LEGACY_MONOLITH_PROXY_BASE_URL === "string" &&
        app.config.LEGACY_MONOLITH_PROXY_BASE_URL.trim().length > 0,
      oauthIdpContinueUriEcho: resolveFirebaseToolkitContinueUri(app.config),
      appleNoncePostBodySupported: true,
      appleConfigMode: "backend-firebase-rest" as const,
      acceptedAppleOAuthExchangeModes: [...APPLE_OAUTH_EXCHANGE_MODES],
      appleNativeJwtJwkRouteSupported: true,
      corsNote: "see Fastify CORS/register — not enumerated here",
      firebaseConsoleAppleProviderConfigured: null as boolean | null,
      firebaseConsoleGoogleProviderConfigured: null as boolean | null
    }),
  );

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
