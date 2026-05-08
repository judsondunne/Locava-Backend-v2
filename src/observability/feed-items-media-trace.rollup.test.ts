import test from "node:test";
import assert from "node:assert";
import { rollupFeedCardMediaReadyCounts } from "./feed-items-media-trace.js";

test("rollupFeedCardMediaReadyCounts tags legacy-only rows", () => {
  const items = [
    {
      postId: "post_a",
      assets: [{ type: "video" }],
      appPostV2: {
        media: {
          assets: [
            {
              type: "video",
              video: { playback: {} },
            },
          ],
        },
      },
    },
  ];
  const r = rollupFeedCardMediaReadyCounts(items);
  assert.strictEqual(r.feedCardLegacyOnlyCount, 1);
  assert.ok(Array.isArray(r.feedCardLegacyOnlyDetails));
  assert.strictEqual((r.feedCardLegacyOnlyDetails as { postId: string }[])[0]?.postId, "post_a");
});
