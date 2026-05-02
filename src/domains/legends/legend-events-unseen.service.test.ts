import { afterEach, describe, expect, it, vi } from "vitest";
import { loadUnseenLegendEventsFast } from "./legend-events-unseen.service.js";
import { legendRepository } from "./legend.repository.js";
import * as firestoreClient from "../../repositories/source-of-truth/firestore-client.js";

describe("loadUnseenLegendEventsFast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns degraded timeout before optional work budget when query hangs", async () => {
    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue({} as never);
    vi.spyOn(legendRepository, "unseenLegendEventsQuery").mockReturnValue({
      get: () => new Promise(() => undefined)
    } as never);
    const log = { warn: vi.fn(), info: vi.fn() };
    vi.useFakeTimers();
    const pending = loadUnseenLegendEventsFast({ viewerId: "viewer-1", log: log as never });
    await vi.advanceTimersByTimeAsync(60);
    const out = await pending;
    vi.useRealTimers();
    expect(out.degraded).toBe(true);
    expect(out.reason).toBe("timeout");
    expect(out.events).toEqual([]);
    expect(out.dbQueries).toBe(0);
  });
});
