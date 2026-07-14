import { describe, expect, it } from "vitest";
import {
  REEL_TEMPLATES_DEFAULT_LIMIT,
  REEL_TEMPLATES_SCAN_LIMIT,
  ReelTemplatesListQuerySchema
} from "./reel-templates.contract.js";

describe("reel-templates contract limits", () => {
  it("keeps a recency scan pool larger than the default page size", () => {
    expect(REEL_TEMPLATES_SCAN_LIMIT).toBeGreaterThan(REEL_TEMPLATES_DEFAULT_LIMIT);
    expect(REEL_TEMPLATES_SCAN_LIMIT).toBeLessThanOrEqual(200);
  });

  it("accepts an optional client limit up to 60", () => {
    expect(ReelTemplatesListQuerySchema.parse({}).limit).toBeUndefined();
    expect(ReelTemplatesListQuerySchema.parse({ limit: "30" }).limit).toBe(30);
    expect(() => ReelTemplatesListQuerySchema.parse({ limit: "61" })).toThrow();
  });
});
