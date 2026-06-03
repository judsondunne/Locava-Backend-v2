import { describe, expect, it } from "vitest";
import { renderOpenStreetMapNationalCopierPage } from "./openstreetmap-national-copier.js";

describe("renderOpenStreetMapNationalCopierPage", () => {
  it("renders without crashing and includes core guard labels", () => {
    const html = renderOpenStreetMapNationalCopierPage();
    expect(html).toContain("Master National OSM Copier");
    expect(html).toContain("unexploredSpots");
    expect(html).toContain("unexploredRoutes");
    expect(html).toContain("/admin/openstreetmap/api/national-copier");
    expect(html).toContain("Dry Run First Accepted Docs");
    expect(html).toContain("Start Write Run");
    expect(html).toContain("I_UNDERSTAND_THIS_WILL_WRITE_NATIONAL_UNEXPLORED_SPOTS");
    // Ensure the page makes the /posts forbid statement visible to the user.
    expect(html.toLowerCase()).toContain("/posts");
  });
});
