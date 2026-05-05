import { describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/source-of-truth/firestore-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getFirestoreSourceClient: vi.fn()
  };
});

import { legendRepository } from "./legend.repository.js";

describe("legendRepository.cancelStage", () => {
  it("rejects cancelling stages owned by another user", async () => {
    const getMock = vi.fn(async () => ({
      exists: true,
      data: () => ({ stageId: "s1", userId: "owner", status: "staged" })
    }));
    const setMock = vi.fn(async () => {});
    const db = {
      collection: () => ({
        doc: () => ({
          get: getMock,
          set: setMock
        })
      })
    };
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockReturnValue(db);
    const out = await legendRepository.cancelStage("s1", "attacker");
    expect(out.cancelled).toBe(false);
    expect(setMock).not.toHaveBeenCalled();
  });
});

