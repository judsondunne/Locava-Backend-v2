import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetVersionConfigCacheForTests,
  resolveVersionConfig
} from "./versionConfig.service.js";

const firestoreClient = vi.hoisted(() => ({
  get: vi.fn()
}));

vi.mock("../../repositories/source-of-truth/firestore-client.js", () => ({
  getFirestoreSourceClient: () => ({
    collection: () => ({
      doc: () => ({
        get: firestoreClient.get
      })
    })
  })
}));

describe("resolveVersionConfig", () => {
  afterEach(() => {
    resetVersionConfigCacheForTests();
    firestoreClient.get.mockReset();
  });

  it("returns Firestore version/config fields for the native contract", async () => {
    firestoreClient.get.mockResolvedValue({
      exists: true,
      data: () => ({
        versionNumber: "3.3.9",
        forceUpdate: true,
        shouldUpdate: true
      })
    });

    const resolved = await resolveVersionConfig();
    expect(resolved).toMatchObject({
      success: true,
      versionNumber: "3.3.9",
      forceUpdate: true,
      shouldUpdate: true,
      source: "firestore"
    });
  });

  it("defaults missing flags to false", async () => {
    firestoreClient.get.mockResolvedValue({
      exists: true,
      data: () => ({
        versionNumber: "3.3.9"
      })
    });

    const resolved = await resolveVersionConfig();
    expect(resolved.forceUpdate).toBe(false);
    expect(resolved.shouldUpdate).toBe(false);
  });
});
