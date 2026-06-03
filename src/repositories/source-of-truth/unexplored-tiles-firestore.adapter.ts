import type { UnexploredTile } from "../../contracts/entities/osm-national-entities.contract.js";
import {
  osmNationalChunkedSetDocuments,
  type OsmNationalWriteOptions,
} from "./osm-national-runs-firestore.adapter.js";

const COLLECTION = "unexploredTiles";

export async function bulkWriteUnexploredTiles(
  tiles: UnexploredTile[],
  options: OsmNationalWriteOptions
): Promise<number> {
  return osmNationalChunkedSetDocuments(COLLECTION, tiles, "tileKey", {
    ...options,
    operation: options.operation || "bulkWriteUnexploredTiles",
  });
}
