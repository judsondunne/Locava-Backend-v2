import { describe, expect, it } from "vitest";
import { errorRingBuffer } from "./error-ring-buffer.js";

describe("errorRingBuffer", () => {
  it("caps entries to the bounded limit", () => {
    errorRingBuffer.clear();
    for (let index = 0; index < 220; index += 1) {
      errorRingBuffer.capture("error", [{ requestId: `req-${index}` }, `error-${index}`]);
    }
    const entries = errorRingBuffer.getRecent(250);
    expect(entries).toHaveLength(200);
    expect(entries[0]?.message).toBe("error-219");
    expect(entries.at(-1)?.message).toBe("error-20");
  });
});
