import type { FastifyInstance } from "fastify";
import { buildViewerContext } from "../../auth/viewer-context.js";
import { inventoryRouteDetailContract } from "../../contracts/surfaces/inventory-route-detail.contract.js";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import { getInventoryRouteById } from "../../repositories/source-of-truth/inventory-routes-firestore.adapter.js";

export async function registerV2InventoryRouteDetailRoutes(app: FastifyInstance): Promise<void> {
  app.get(inventoryRouteDetailContract.path, async (request, reply) => {
    setRouteName(inventoryRouteDetailContract.routeName);
    buildViewerContext(request);
    const id = String((request.params as { id?: string }).id ?? "").trim();
    if (!id) {
      return reply.status(400).send(failure("missing_id", "Route id is required"));
    }
    const route = await getInventoryRouteById(id);
    if (!route) {
      return reply.status(404).send(failure("inventory_route_not_found", "Inventory route not found", { id }));
    }
    return success({
      routeName: "inventory.route.detail.get" as const,
      route,
    });
  });
}
