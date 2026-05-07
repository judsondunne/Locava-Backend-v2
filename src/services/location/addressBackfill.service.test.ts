import { describe, expect, it, vi } from "vitest";
import {
  AddressBackfillService,
  assertAddressOnlyWritePayload,
  buildAddressOnlyWritePayload,
  extractCoordinates,
  hasMissingAddress,
  sanitizeResolvedAddress
} from "./addressBackfill.service.js";

const firestoreMockState = vi.hoisted(() => ({ db: null as any }));

function makeDoc(id: string, data: Record<string, unknown>) {
  const update = vi.fn(async () => {});
  return {
    id,
    data: () => data,
    update
  };
}

function buildDb(docs: Array<ReturnType<typeof makeDoc>>) {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  return {
    collection(name: string) {
      if (name !== "posts") throw new Error("unexpected_collection");
      return {
        orderBy(field: string, direction: string) {
          if (field !== "time" || direction !== "desc") throw new Error("unexpected_order");
          return {
            offset(skip: number) {
              return {
                limit(limit: number) {
                  return {
                    async get() {
                      const selected = docs.slice(skip, skip + limit);
                      return { size: selected.length, docs: selected };
                    }
                  };
                }
              };
            },
            limit(limit: number) {
              return {
                async get() {
                  const selected = docs.slice(0, limit);
                  return { size: selected.length, docs: selected };
                }
              };
            }
          };
        },
        doc(id: string) {
          return {
            async get() {
              const doc = byId.get(id);
              return { exists: Boolean(doc), data: () => doc?.data() ?? null };
            },
            async update(payload: Record<string, unknown>) {
              const doc = byId.get(id);
              if (!doc) throw new Error("post_not_found");
              await doc.update(payload);
            }
          };
        }
      };
    }
  };
}

vi.mock("../../repositories/source-of-truth/firestore-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getFirestoreSourceClient: vi.fn(() => firestoreMockState.db)
  };
});

describe("addressBackfill.service", () => {
  it("extracts nested coordinates first and falls back to root lat/long", () => {
    expect(extractCoordinates({ location: { coordinates: { lat: 1.5, lng: 2.5 } }, lat: 9, long: 10 })).toEqual({
      lat: 1.5,
      lng: 2.5
    });
    expect(extractCoordinates({ lat: 47.1, long: 19.2 })).toEqual({ lat: 47.1, lng: 19.2 });
    expect(extractCoordinates({ lat: "bad", long: 10 })).toBeNull();
  });

  it("detects missing address candidates and supports force", () => {
    expect(hasMissingAddress({ location: { display: { address: null } } }, false)).toBe(true);
    expect(hasMissingAddress({ location: { display: {} } }, false)).toBe(true);
    expect(hasMissingAddress({ location: { display: { address: "" } } }, false)).toBe(true);
    expect(hasMissingAddress({ location: { display: { address: "39.7913, 19.9218" } } }, false)).toBe(true);
    expect(hasMissingAddress({ location: { display: { address: "Budapest, HU" } } }, false)).toBe(false);
    expect(hasMissingAddress({ location: { display: { address: "Budapest, HU" } } }, true)).toBe(true);
  });

  it("enforces strict address-only write allowlist", () => {
    expect(() =>
      assertAddressOnlyWritePayload({
        "location.display.address": "A"
      })
    ).not.toThrow();
    expect(() => assertAddressOnlyWritePayload({ schema: { version: 2 } })).toThrow(/disallowed_field/);
    expect(() => assertAddressOnlyWritePayload({ "media.cover.url": "x" })).toThrow(/disallowed_field/);
    expect(() => assertAddressOnlyWritePayload({ engagement: {} })).toThrow(/disallowed_field/);
  });

  it("dry run resolves address and does not call update", async () => {
    const post = makeDoc("post-1", {
      time: "2026-05-06T11:00:00.000Z",
      location: { coordinates: { lat: 47.496088, lng: 19.054006 }, display: { address: null } }
    });
    firestoreMockState.db = buildDb([post]);
    const service = new AddressBackfillService(async () => ({
      matched: true,
      source: "network",
      addressDisplayName: "Resolved Address",
      city: "Budapest",
      region: "Budapest",
      country: "HU",
      county: null
    }));
    const result = await service.runOne({ postId: "post-1", dryRun: true });
    expect(result.status).toBe("resolved");
    expect(result.foundAddress).toBe("Resolved Address");
    expect(post.update).not.toHaveBeenCalled();
  });

  it("requires confirmAddressOnlyWrite=true for real writes", async () => {
    const post = makeDoc("post-2", {
      time: "2026-05-06T10:00:00.000Z",
      location: { coordinates: { lat: 47.5, lng: 19.0 }, display: { address: null } }
    });
    firestoreMockState.db = buildDb([post]);
    const service = new AddressBackfillService(async () => ({
      matched: true,
      source: "network",
      addressDisplayName: "Address",
      city: "Budapest",
      region: "Budapest",
      country: "HU",
      county: null
    }));
    const fail = await service.runOne({ postId: "post-2", dryRun: false, confirmAddressOnlyWrite: false });
    expect(fail.status).toBe("failed");
    expect(post.update).not.toHaveBeenCalled();
    const ok = await service.runOne({ postId: "post-2", dryRun: false, confirmAddressOnlyWrite: true });
    expect(ok.status).toBe("updated");
    expect(post.update).toHaveBeenCalledTimes(1);
    const writePayload = post.update.mock.calls[0][0] as Record<string, unknown>;
    expect(writePayload).toEqual(buildAddressOnlyWritePayload({
      address: "Address"
    }));
    expect(Object.keys(writePayload).every((key) => key.startsWith("location.display."))).toBe(true);
  });

  it("sanitizes resolved address by dropping county and country suffixes", () => {
    expect(
      sanitizeResolvedAddress("730, High Street, Easton, Northampton County, Pennsylvania, United States")
    ).toBe("730, High Street, Easton, Pennsylvania");
    expect(
      sanitizeResolvedAddress("Κέρκυρας - Παλαιοκαστρίτσας, Παλαιοκαστρίτσα, Περιφερειακή Ενότητα Κέρκυρας, Περιφέρεια Ιονίων Νήσων, Ελλάδα")
    ).toBe("Κέρκυρας - Παλαιοκαστρίτσας, Παλαιοκαστρίτσα, Περιφέρεια Ιονίων Νήσων");
  });

  it("batch processes newest first and continues after failures", async () => {
    const first = makeDoc("newest", {
      time: "2026-05-06T11:10:00.000Z",
      location: { coordinates: { lat: 47.1, lng: 19.1 }, display: { address: null } }
    });
    const second = makeDoc("second", {
      time: "2026-05-06T11:00:00.000Z",
      location: { coordinates: { lat: 47.2, lng: 19.2 }, display: { address: null } }
    });
    const third = makeDoc("third", {
      time: "2026-05-06T10:50:00.000Z",
      location: { coordinates: { lat: 47.3, lng: 19.3 }, display: { address: "Already here" } }
    });
    firestoreMockState.db = buildDb([first, second, third]);
    const service = new AddressBackfillService(async ({ lat }) => {
      if (lat === 47.2) throw new Error("geocode_failed");
      return {
        matched: true,
        source: "network",
        addressDisplayName: "Address " + lat,
        city: "Budapest",
        region: "Budapest",
        country: "HU",
        county: null
      };
    });
    const result = await service.runBatch({ dryRun: true, limit: 2 });
    expect(result.attempted).toBe(2);
    expect(result.results[0]?.postId).toBe("newest");
    expect(result.results[1]?.postId).toBe("second");
    expect(result.results[0]?.status).toBe("resolved");
    expect(result.results[1]?.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.skippedAlreadyAddress).toBeGreaterThanOrEqual(0);
    expect(first.update).not.toHaveBeenCalled();
    expect(second.update).not.toHaveBeenCalled();
  });
});
