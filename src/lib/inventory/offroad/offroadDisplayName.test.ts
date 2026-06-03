import { describe, expect, it } from "vitest";
import { formatOffroadDisplayName } from "./offroadDisplayName.js";

describe("formatOffroadDisplayName", () => {
  it("title-cases ALL CAPS VTrans-style names", () => {
    expect(formatOffroadDisplayName("BROWN BROOK RD")).toBe("Brown Brook Rd");
    expect(formatOffroadDisplayName("TOWN HWY 5")).toBe("Town Hwy 5");
    expect(formatOffroadDisplayName("FERRY RD")).toBe("Ferry Rd");
  });

  it("leaves mixed-case names unchanged", () => {
    expect(formatOffroadDisplayName("Blood Brook Road")).toBe("Blood Brook Road");
    expect(formatOffroadDisplayName("McDonald's Lane")).toBe("McDonald's Lane");
  });
});
