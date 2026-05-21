import type {
  InventoryImportInput,
  InventoryRawObject,
  InventorySourceAdapter,
} from "./inventorySource.types.js";
import { FIXTURE_INVENTORY_RAW_OBJECTS } from "./hartlandFixturePlaces.js";

export class FixtureInventorySource implements InventorySourceAdapter {
  sourceName = "fixture";

  async loadRawObjects(input: InventoryImportInput): Promise<InventoryRawObject[]> {
    const limit = input.limit ?? FIXTURE_INVENTORY_RAW_OBJECTS.length;
    return FIXTURE_INVENTORY_RAW_OBJECTS.slice(0, limit);
  }
}

export const fixtureInventorySource = new FixtureInventorySource();

// Re-export for tests / map preview tooling.
export { FIXTURE_INVENTORY_RAW_OBJECTS } from "./hartlandFixturePlaces.js";
