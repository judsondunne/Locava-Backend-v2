import { describe, expect, it, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({
  preview: vi.fn(async () => ({
    scannedCount: 5,
    candidateCount: 2,
    skippedAlreadyAddressCount: 1,
    skippedInvalidCoordsCount: 1,
    skippedDeletedCount: 1,
    rows: [],
    nextCursor: "5",
    limit: 2
  })),
  runOne: vi.fn(async () => ({
    postId: "p1",
    lat: 1,
    lng: 2,
    foundAddress: "A",
    writePayload: { "location.display.address": "A" },
    dryRun: true,
    status: "resolved" as const
  })),
  runBatch: vi.fn(async () => ({
    scanned: 5,
    attempted: 2,
    updated: 0,
    dryRunResolved: 2,
    skippedAlreadyAddress: 1,
    skippedInvalidCoordinates: 1,
    failed: 0,
    errors: [],
    results: [],
    nextCursor: "5"
  }))
}));

vi.mock("../../services/location/addressBackfill.service.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    addressBackfillService: serviceMock
  };
});

import { createApp } from "../../app/createApp.js";

describe("debug address backfill routes", () => {
  it("serves dashboard html", async () => {
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({ method: "GET", url: "/debug/address-backfill" });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Post Address Backfill");
    } finally {
      await app.close();
    }
  });

  it("requires explicit confirm for non-dry run", async () => {
    const app = createApp({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ENABLE_POST_REBUILDER_DEBUG_ROUTES: true
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/debug/api/address-backfill/run-one",
        payload: { postId: "abc", dryRun: false, confirmAddressOnlyWrite: false }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "confirm_address_only_write_required" });
      expect(serviceMock.runOne).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
