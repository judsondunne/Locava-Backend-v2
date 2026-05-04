import { describe, expect, it } from "vitest";
import { validateRouteRegistry } from "./route-registry.validation.js";

describe("route registry validation", () => {
  it("has no duplicate route names", () => {
    const result = validateRouteRegistry();
    expect(result.duplicateRouteNames).toEqual([]);
  });

  it("has no method/path conflicts with different names", () => {
    const result = validateRouteRegistry();
    expect(result.duplicateMethodPathWithDifferentNames).toEqual([]);
  });
});
