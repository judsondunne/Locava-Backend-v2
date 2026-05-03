import type { FastifyInstance } from "fastify";
import { success } from "../../lib/response.js";

export async function registerLaunchCompatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config/version", async () =>
    success({
      minSupportedVersion: "0.0.0",
      latestVersion: "999.0.0",
      forceUpgrade: false,
      /** Flat fields legacy clients still probe (also present under `data`). */
      success: true,
      versionNumber: "999.0.0",
      shouldUpdate: false,
      forceUpdate: false
    })
  );

}
