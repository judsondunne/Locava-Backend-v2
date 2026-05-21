import { describe, expect, it } from "vitest";
import { mapRouteCategoryFromTags, mapSpotCategoryFromTags } from "./inventoryCategories.js";

describe("inventoryCategories", () => {
  it("maps waterfall tags to viewpoint/waterfall categories", () => {
    const mapped = mapSpotCategoryFromTags({ natural: "waterfall", tourism: "attraction" });
    expect(mapped.category).toBe("attraction");
    expect(mapped.categories).toContain("waterfall");
  });

  it("maps hiking route tags", () => {
    const mapped = mapRouteCategoryFromTags({ route: "hiking", highway: "path" });
    expect(mapped.activity).toBe("hiking");
    expect(mapped.categories).toContain("hiking");
  });
});
