import { describe, expect, it } from "vitest";

import { evaluateReplayBudget } from "./realUserReplayBudgets.js";

describe("real user replay budgets", () => {
  it("fails first-page feed replay budgets when read/query counts regress above the hardened threshold", () => {
    const result = evaluateReplayBudget({
      route: "/v2/feed/for-you/simple?limit=5",
      method: "GET",
      latencyMs: 1_163,
      payloadBytes: 21_279,
      reads: 44,
      writes: 0,
      queries: 9,
      cursorUsed: false,
      requestGroup: "first_paint",
    });

    expect(result.budget?.key).toBe("feed.first_page");
    expect(result.hardFailures).toEqual(
      expect.arrayContaining([
        "reads_exceeded:44>25",
        "queries_exceeded:9>6",
      ]),
    );
  });

  it("accepts the hardened first-page feed read/query envelope captured by the read-only audit harness", () => {
    const result = evaluateReplayBudget({
      route: "/v2/feed/for-you/simple?limit=5",
      method: "GET",
      latencyMs: 783.7,
      payloadBytes: 21_279,
      reads: 16,
      writes: 0,
      queries: 6,
      cursorUsed: false,
      requestGroup: "first_paint",
    });

    expect(result.budget?.key).toBe("feed.first_page");
    expect(result.hardFailures).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "latency_target_exceeded:783.7>500",
      ]),
    );
  });
});
