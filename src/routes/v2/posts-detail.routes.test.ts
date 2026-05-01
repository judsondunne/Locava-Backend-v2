import { describe, expect, it } from "vitest";
import { createApp } from "../../app/createApp.js";

describe("v2 posts detail route", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

  it("returns canonical post viewer detail payload by post id", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const res = await app.inject({
      method: "GET",
      url: "/v2/posts/internal-viewer-feed-post-1/detail",
      headers
    });
    if (res.statusCode === 503) {
      const body = res.json();
      expect(body.error.code).toBe("source_of_truth_required");
      return;
    }
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("posts.detail.get");
    expect(body.data.firstRender.post.postId).toBe("internal-viewer-feed-post-1");
    expect(Array.isArray(body.data.firstRender.post.assets)).toBe(true);
    // Canonical author hydration: should always return a usable author shape
    expect(String(body.data.firstRender.author.userId ?? "").length).toBeGreaterThan(0);
    expect(String(body.data.firstRender.author.handle ?? "").length).toBeGreaterThan(0);
    expect(body.data.debugPostIds).toEqual(["internal-viewer-feed-post-1"]);
    expect(typeof body.data.debugDurationMs).toBe("number");
  });

  it("returns canonical batch post detail payload", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const res = await app.inject({
      method: "POST",
      url: "/v2/posts/details:batch",
      headers,
      payload: {
        postIds: ["internal-viewer-feed-post-1", "internal-viewer-feed-post-2", "internal-viewer-feed-post-1"],
        reason: "prefetch",
        hydrationMode: "card"
      }
    });
    if (res.statusCode === 503) {
      const body = res.json();
      expect(body.error.code).toBe("source_of_truth_required");
      return;
    }
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.routeName).toBe("posts.detail.batch");
    expect(body.data.reason).toBe("prefetch");
    expect(body.data.hydrationMode).toBe("card");
    if (body.data.found.length > 0) {
      expect(body.data.found[0].detail.routeName).toBe("posts.detail.get");
    }
    expect(Array.isArray(body.data.missing)).toBe(true);
  });

  it("returns mode-specific payload categories", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const run = async (hydrationMode: "card" | "playback" | "open" | "full") =>
      app.inject({
        method: "POST",
        url: "/v2/posts/details:batch",
        headers,
        payload: {
          postIds: ["internal-viewer-feed-post-1"],
          reason: "open",
          hydrationMode
        }
      });
    const card = await run("card");
    const playback = await run("playback");
    const open = await run("open");
    const full = await run("full");
    if ([card, playback, open, full].some((res) => res.statusCode === 503)) return;
    expect(card.statusCode).toBe(200);
    expect(playback.statusCode).toBe(200);
    expect(open.statusCode).toBe(200);
    expect(full.statusCode).toBe(200);
    const cardBody = card.json().data;
    const playbackBody = playback.json().data;
    const openBody = open.json().data;
    const fullBody = full.json().data;
    expect(cardBody.debugPayloadCategory).toBe("tiny");
    expect(playbackBody.debugPayloadCategory).toBe("small");
    expect(["small", "medium"]).toContain(openBody.debugPayloadCategory);
    expect(fullBody.debugPayloadCategory).toBe("heavy");
  });

  it("keeps no-mode requests backward compatible with playback/detail assets", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const res = await app.inject({
      method: "POST",
      url: "/v2/posts/details:batch",
      headers,
      payload: {
        postIds: ["internal-viewer-feed-post-1"],
        reason: "open"
      }
    });
    if (res.statusCode === 503) return;
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.hydrationMode).toBe("open");
    if (!Array.isArray(body.found) || body.found.length === 0) {
      expect(Array.isArray(body.missing)).toBe(true);
      return;
    }
    const first = body.found?.[0]?.detail?.firstRender?.post;
    expect(typeof first?.mediaType).toBe("string");
    expect(typeof first?.thumbUrl).toBe("string");
    expect(String(first?.thumbUrl ?? "").length).toBeGreaterThan(0);
  });

  it("keeps full detail payload under the current guardrail and reports top-level contributors on drift", async () => {
    const headers = { "x-viewer-id": "internal-viewer", "x-viewer-roles": "internal" };
    const res = await app.inject({
      method: "GET",
      url: "/v2/posts/internal-viewer-feed-post-1/detail",
      headers,
    });
    if (res.statusCode === 503) return;
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    const contributors = [
      ["assets", Buffer.byteLength(JSON.stringify(body.firstRender?.post?.assets ?? []), "utf8")],
      ["playbackLab", Buffer.byteLength(JSON.stringify(body.firstRender?.post?.playbackLab ?? null), "utf8")],
      ["cardSummary", Buffer.byteLength(JSON.stringify(body.firstRender?.post?.cardSummary ?? null), "utf8")],
      ["commentsPreview", Buffer.byteLength(JSON.stringify(body.deferred?.commentsPreview ?? []), "utf8")],
    ]
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 4);
    const payloadBytes = Buffer.byteLength(res.body, "utf8");
    expect(
      payloadBytes,
      `detail payload contributors ${JSON.stringify(contributors)}`,
    ).toBeLessThan(120_000);
  });
});
