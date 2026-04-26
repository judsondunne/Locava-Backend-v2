import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PostingStatePersistence } from "./posting-state.persistence.js";

describe("posting state persistence", () => {
  it("persists state across repository instances", async () => {
    const filePath = join(process.cwd(), "state", `posting-state-test-${randomUUID().slice(0, 8)}.json`);
    const first = new PostingStatePersistence(filePath);
    await first.mutate((draft) => {
      draft.sessionsById["ups_test_1"] = {
        sessionId: "ups_test_1",
        viewerId: "internal-viewer",
        clientSessionKey: "session-key-test-1",
        mediaCountHint: 1,
        createdAtMs: 1,
        expiresAtMs: 2,
        state: "open"
      };
      draft.sessionsByViewerKey["internal-viewer:session-key-test-1"] = "ups_test_1";
    });

    const second = new PostingStatePersistence(filePath);
    const state = await second.getState();
    expect(state.sessionsById["ups_test_1"]).toBeTruthy();
    expect(state.sessionsByViewerKey["internal-viewer:session-key-test-1"]).toBe("ups_test_1");
  });
});
