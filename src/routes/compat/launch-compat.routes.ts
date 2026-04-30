import type { FastifyInstance } from "fastify";
import { success } from "../../lib/response.js";

export async function registerLaunchCompatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/analytics/v2/events", async () =>
    success({
      accepted: true,
      queued: 0,
      dropped: 0
    })
  );

  app.get("/api/config/version", async () =>
    success({
      minSupportedVersion: "0.0.0",
      latestVersion: "0.0.0",
      forceUpgrade: false
    })
  );

  app.patch("/api/v1/product/viewer", async () =>
    success({
      ok: true,
      updated: false
    })
  );
}
