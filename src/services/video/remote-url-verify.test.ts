import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyRemoteMp4Faststart } from "./remote-url-verify.js";

describe("verifyRemoteMp4Faststart", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects URL equal to original", async () => {
    const u = "https://cdn.example.com/same.mp4";
    const r = await verifyRemoteMp4Faststart(u, u);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("url_equals_original");
  });

  it("falls back to range metadata when HEAD is forbidden", async () => {
    const mp4Prefix = Buffer.from("xxxxmoovyyyymdatzzzz", "binary");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        new Response(mp4Prefix, {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-range": "bytes 0-19/12000",
          },
        }),
      );

    const r = await verifyRemoteMp4Faststart("https://cdn.example.com/v.mp4", "https://cdn.example.com/original.mp4");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentLength).toBe(12000);
      expect(r.moovHint).toBe("moov_before_mdat_in_prefix");
    }
  });
});
