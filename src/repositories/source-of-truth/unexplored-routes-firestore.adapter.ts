import type { UnexploredRoute } from "../../contracts/entities/osm-national-entities.contract.js";
import {
  osmNationalChunkedSetDocuments,
  type OsmNationalWriteOptions,
} from "./osm-national-runs-firestore.adapter.js";

const COLLECTION = "unexploredRoutes";

export async function bulkWriteUnexploredRoutes(
  routes: UnexploredRoute[],
  options: OsmNationalWriteOptions
): Promise<number> {
  return osmNationalChunkedSetDocuments(COLLECTION, routes, "id", {
    ...options,
    operation: options.operation || "bulkWriteUnexploredRoutes",
  });
}
