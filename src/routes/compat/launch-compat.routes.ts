import type { FastifyInstance } from "fastify";
import { success } from "../../lib/response.js";

export async function registerLaunchCompatRoutes(app: FastifyInstance): Promise<void> {
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
