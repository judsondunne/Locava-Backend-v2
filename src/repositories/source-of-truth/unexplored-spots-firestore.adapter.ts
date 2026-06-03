import type { UnexploredSpot } from "../../contracts/entities/osm-national-entities.contract.js";
import {
  osmNationalChunkedSetDocuments,
  type OsmNationalWriteOptions,
} from "./osm-national-runs-firestore.adapter.js";

const COLLECTION = "unexploredSpots";

export async function bulkWriteUnexploredSpots(
  spots: UnexploredSpot[],
  options: OsmNationalWriteOptions
): Promise<number> {
  return osmNationalChunkedSetDocuments(COLLECTION, spots, "id", {
    ...options,
    operation: options.operation || "bulkWriteUnexploredSpots",
  });
}
