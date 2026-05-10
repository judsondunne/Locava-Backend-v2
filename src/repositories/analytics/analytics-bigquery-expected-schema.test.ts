import { describe, expect, it } from "vitest";
import { compareClientEventsSchema } from "./analytics-bigquery-expected-schema.js";

describe("compareClientEventsSchema", () => {
  it("passes when all expected columns exist with matching types", () => {
    const fields = [
      { name: "event", type: "STRING" },
      { name: "schemaVersion", type: "STRING" },
      { name: "userId", type: "STRING" },
      { name: "anonId", type: "STRING" },
      { name: "sessionId", type: "STRING" },
      { name: "clientTime", type: "TIMESTAMP" },
      { name: "receivedAt", type: "TIMESTAMP" },
      { name: "platform", type: "STRING" },
      { name: "requestIp", type: "STRING" },
      { name: "userAgent", type: "STRING" },
      { name: "properties", type: "STRING" }
    ];
    expect(compareClientEventsSchema(fields)).toEqual({ ok: true, issues: [] });
  });

  it("reports missing columns", () => {
    const { ok, issues } = compareClientEventsSchema([{ name: "event", type: "STRING" }]);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.includes("missing column"))).toBe(true);
  });

  it("reports type mismatches", () => {
    const fields = [
      { name: "event", type: "STRING" },
      { name: "schemaVersion", type: "STRING" },
      { name: "userId", type: "STRING" },
      { name: "anonId", type: "STRING" },
      { name: "sessionId", type: "STRING" },
      { name: "clientTime", type: "STRING" },
      { name: "receivedAt", type: "TIMESTAMP" },
      { name: "platform", type: "STRING" },
      { name: "requestIp", type: "STRING" },
      { name: "userAgent", type: "STRING" },
      { name: "properties", type: "STRING" }
    ];
    const { ok, issues } = compareClientEventsSchema(fields);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.includes("clientTime"))).toBe(true);
  });
});
