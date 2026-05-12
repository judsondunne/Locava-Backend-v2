import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveVersionConfig } from "../../services/config/versionConfig.service.js";

function readOptionalHeader(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].trim().length > 0) {
    return raw[0].trim();
  }
  return null;
}

export async function registerLaunchCompatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config/version", async (request, reply: FastifyReply) => {
    const resolved = await resolveVersionConfig();
    const platform = readOptionalHeader(request, "x-client-platform");
    const clientVersion = readOptionalHeader(request, "x-client-app-version");
    const clientBuild = readOptionalHeader(request, "x-client-app-build");

    request.log.info({
      event: "UPDATE_CONFIG_RESOLVED",
      platform,
      clientVersion,
      clientBuild,
      forceUpdate: resolved.forceUpdate,
      shouldUpdate: resolved.shouldUpdate,
      versionNumber: resolved.versionNumber,
      updateRequired: resolved.forceUpdate,
      updateAvailable: resolved.shouldUpdate,
      source: resolved.source,
      cacheAgeMs: resolved.cacheAgeMs
    });

    return reply.send({
      success: resolved.success,
      versionNumber: resolved.versionNumber,
      forceUpdate: resolved.forceUpdate,
      shouldUpdate: resolved.shouldUpdate,
      latestVersion: resolved.versionNumber,
      minimumVersion: resolved.versionNumber,
      updateAvailable: resolved.shouldUpdate,
      updateRequired: resolved.forceUpdate,
      forceUpgrade: resolved.forceUpdate
    });
  });
}
