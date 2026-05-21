import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { inventorySpotDetailContract } from "../../contracts/surfaces/inventory-spot-detail.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { getInventorySpotById } from "../../repositories/source-of-truth/inventory-spots-firestore.adapter.js";

export async function registerV2InventorySpotDetailRoutes(app: FastifyInstance): Promise<void> {
  app.get(inventorySpotDetailContract.path, async (request, reply) => {
    setRouteName(inventorySpotDetailContract.routeName);
    buildViewerContext(request);
    const id = String((request.params as { id?: string }).id ?? "").trim();
    if (!id) {
      return reply.status(400).send(failure("missing_id", "Spot id is required"));
    }
    const spot = await getInventorySpotById(id);
    if (!spot) {
      return reply.status(404).send(failure("inventory_spot_not_found", "Inventory spot not found", { id }));
    }
    return success({
      routeName: "inventory.spot.detail.get" as const,
      spot,
    });
  });
}
