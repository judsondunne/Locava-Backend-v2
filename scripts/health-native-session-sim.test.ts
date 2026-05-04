import { describe, expect, it } from "vitest";
import { assertSafeRequest } from "./health-native-session-sim.mts";

describe("health native session simulator safety guard", () => {
  it("blocks non-whitelisted POST in read-only mode", () => {
    expect(() =>
      assertSafeRequest(
        {
          baseUrl: "http://localhost:3901",
          dashboardToken: null,
          authToken: null,
          viewerId: "viewer",
          lat: 40.0,
          lng: -74.0,
          radiusMiles: [1],
          readOnly: true,
          mutationTestMode: false,
          maxPages: 2,
          pageSize: 5,
          networkProfile: "wifi",
          concurrencyProfile: "native_startup",
        },
        {
          name: "unsafe_like",
          method: "POST",
          path: "/v2/posts/abc/like",
          phase: "deferred_interactive",
        },
      ),
    ).toThrow(/read_only_blocked/);
  });
});
