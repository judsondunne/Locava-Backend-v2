import { describe, expect, it } from "vitest";
import { verifyRemoteMp4Faststart } from "./remote-url-verify.js";

describe("verifyRemoteMp4Faststart", () => {
  it("rejects URL equal to original", async () => {
    const u = "https://cdn.example.com/same.mp4";
    const r = await verifyRemoteMp4Faststart(u, u);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("url_equals_original");
  });
});
