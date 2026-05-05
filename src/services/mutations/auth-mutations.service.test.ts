import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushBackgroundWorkForTests,
  getBackgroundWorkSnapshotForTests,
  resetBackgroundWorkForTests,
} from "../../lib/background-work.js";
import { AuthMutationsService } from "./auth-mutations.service.js";

afterEach(() => {
  resetBackgroundWorkForTests();
  vi.restoreAllMocks();
});

describe("AuthMutationsService push token persistence", () => {
  it("defers push-token persistence into background work for the background push-token lane", async () => {
    const set = vi.fn(async () => undefined);
    const service = new AuthMutationsService();
    (service as unknown as { db: unknown }).db = {
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          set,
        })),
      })),
    };
    const claimExclusivePushTokens = vi
      .spyOn(service, "claimExclusivePushTokens")
      .mockImplementation(async () => undefined);

    const result = await service.persistViewerDevicePushTokens(
      "viewer-1",
      {
        expoPushToken: "ExponentPushToken[test-token]",
        pushToken: "ExponentPushToken[test-token]",
        pushTokenPlatform: "ios",
      },
      { deferPersist: true }
    );

    expect(result).toEqual({ persisted: true });
    expect(set).not.toHaveBeenCalled();
    expect(getBackgroundWorkSnapshotForTests().total).toBe(1);

    await flushBackgroundWorkForTests();

    expect(set).toHaveBeenCalledTimes(1);
    expect(claimExclusivePushTokens).toHaveBeenCalledTimes(1);
    expect(getBackgroundWorkSnapshotForTests().total).toBe(0);
  });
});
