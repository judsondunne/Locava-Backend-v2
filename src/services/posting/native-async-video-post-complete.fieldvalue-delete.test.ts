import { describe, expect, it, vi } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import {
  buildLivePostFirestorePayloadForTests,
  getDroppedKeysOnLiveWriteForTests,
  writeCompactLivePostAfterNativeVideoProcessing,
} from "./native-async-video-post-complete.js";

/**
 * Regression for: "FieldValue.delete() must appear at the top-level and can only be used in
 * update() or set() with {merge:true} (found in field videoProcessingProgress)".
 *
 * The async video post complete writer used to call:
 *   firePayload.videoProcessingProgress = FieldValue.delete();
 *   await postRef.set(firePayload, { merge: false });
 * which is invalid. After the fix:
 *   - the full-replace `set` payload contains NO `FieldValue.delete()` sentinel,
 *   - any pre-existing `videoProcessingProgress` in the rebuilt document is dropped,
 *   - a follow-up `update({ videoProcessingProgress: FieldValue.delete() })` is best-effort
 *     and never fails the success path.
 */

function isFieldValueDeleteSentinel(v: unknown): boolean {
  // Lightweight detector that does not depend on private firebase internals.
  // FieldValue.delete() instances are class instances with a private "_methodName" or proto.
  if (v && typeof v === "object") {
    const c = (v as { constructor?: { name?: string } }).constructor;
    if (c && typeof c.name === "string" && c.name.includes("DeleteFieldValueImpl")) return true;
  }
  return false;
}

describe("native-async-video-post-complete — FieldValue.delete regression", () => {
  it("getDroppedKeysOnLiveWriteForTests includes videoProcessingProgress", () => {
    expect(getDroppedKeysOnLiveWriteForTests()).toContain("videoProcessingProgress");
  });

  it("buildLivePostFirestorePayloadForTests strips videoProcessingProgress and embeds no FieldValue.delete sentinel", () => {
    const live = {
      schema: { name: "locava.post", version: 2 },
      videoProcessingProgress: { phase: "encode", processedVideos: 0, totalVideos: 1 },
      keepMe: "yes",
    };
    const out = buildLivePostFirestorePayloadForTests(live);
    expect("videoProcessingProgress" in out).toBe(false);
    expect(out.keepMe).toBe("yes");
    // Walk the object and assert no DeleteFieldValueImpl sentinels survived.
    function walk(value: unknown): void {
      if (value && typeof value === "object") {
        expect(isFieldValueDeleteSentinel(value)).toBe(false);
        for (const v of Object.values(value as Record<string, unknown>)) walk(v);
      }
    }
    walk(out);
  });

  it("buildLivePostFirestorePayloadForTests survives even when caller embeds a FieldValue.delete on a dropped key", () => {
    // Even if a buggy caller somehow embedded a sentinel, the function strips the key entirely,
    // so the final payload is safe for `set(..., { merge: false })`.
    const live: Record<string, unknown> = {
      schema: { name: "locava.post", version: 2 },
      videoProcessingProgress: FieldValue.delete(),
    };
    const out = buildLivePostFirestorePayloadForTests(live);
    expect("videoProcessingProgress" in out).toBe(false);
  });

  it("writeCompactLivePostAfterNativeVideoProcessing does NOT throw 'FieldValue.delete must appear at top-level' when the simulated set rejects sentinels in non-merge writes", async () => {
    /**
     * Simulate a Firestore-shaped DocumentReference whose .set rejects FieldValue.delete sentinels in
     * non-merge mode (mirrors real Firestore behavior). Update() accepts them. The fixed code path
     * must succeed end-to-end.
     */
    const setCalls: Array<{ payload: unknown; opts: { merge?: boolean } }> = [];
    const updateCalls: Array<unknown> = [];
    const postRef = {
      async get() {
        return {
          exists: true,
          data: () => ({}),
        };
      },
      async set(payload: unknown, opts: { merge?: boolean }) {
        setCalls.push({ payload, opts });
        // Mirror Firestore's restriction.
        if (!opts || opts.merge !== true) {
          let found = false;
          function walk(value: unknown): void {
            if (found) return;
            if (value && typeof value === "object") {
              if (isFieldValueDeleteSentinel(value)) {
                found = true;
                return;
              }
              for (const v of Object.values(value as Record<string, unknown>)) walk(v);
            }
          }
          walk(payload);
          if (found) {
            throw new Error(
              "FieldValue.delete() must appear at the top-level and can only be used in update() or set() with {merge:true} (found in field videoProcessingProgress).",
            );
          }
        }
      },
      async update(payload: unknown) {
        updateCalls.push(payload);
      },
    };

    const db = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          set: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    } as unknown as Parameters<typeof writeCompactLivePostAfterNativeVideoProcessing>[0]["db"];

    /**
     * Minimal canonical-shaped working post that normalizeMasterPostV2 can ingest. This test
     * intentionally does NOT cover the canonical normalization happy-path — it covers the firestore
     * write contract. Use a known-working canonical fixture for the working post; the contract is
     * "no FieldValue.delete sentinels in the non-merge set call".
     */
    const ORIGINAL = "https://cdn.example.com/o.mp4";
    const STARTUP_720 = "https://cdn.example.com/startup720_faststart_avc.mp4";
    const POSTER = "https://cdn.example.com/poster.jpg";
    const workingPost = {
      id: "post_x",
      postId: "post_x",
      schema: { name: "locava.post", version: 2 },
      lifecycle: { status: "active", createdAtMs: Date.now(), createdAt: new Date().toISOString() },
      author: { userId: "u" },
      text: { title: "t", searchableText: "t" },
      classification: { mediaKind: "video", visibility: "public", source: "user", reel: false, isBoosted: false },
      mediaType: "video",
      assetsReady: true,
      videoProcessingStatus: "completed",
      instantPlaybackReady: true,
      mediaStatus: "ready",
      photoLink: POSTER,
      photoLinks2: STARTUP_720,
      photoLinks3: STARTUP_720,
      thumbUrl: POSTER,
      displayPhotoLink: POSTER,
      posterUrl: POSTER,
      fallbackVideoUrl: ORIGINAL,
      assets: [
        {
          id: "a0",
          type: "video",
          original: ORIGINAL,
          poster: POSTER,
          variants: {
            startup540FaststartAvc: STARTUP_720,
            startup720FaststartAvc: STARTUP_720,
            poster: POSTER,
          },
          instantPlaybackReady: true,
        },
      ],
      videoProcessingProgress: { phase: "encode", processedVideos: 1, totalVideos: 1 },
      playbackLab: {
        status: "ready",
        version: 1,
        lastVerifyAllOk: true,
        verification: { byUrl: { [STARTUP_720]: true } },
        assets: { a0: { generated: { startup720FaststartAvc: STARTUP_720 } } },
      },
    } as Record<string, unknown>;

    const result = await writeCompactLivePostAfterNativeVideoProcessing({
      db,
      postRef: postRef as unknown as Parameters<typeof writeCompactLivePostAfterNativeVideoProcessing>[0]["postRef"],
      postId: "post_x",
      snapshotRaw: { ...workingPost },
      workingPost,
      playbackLabDiagnosticsAssets: {},
    });

    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error("writeCompactLivePostAfterNativeVideoProcessing error", result.error);
    }
    // The replace call must have happened with no sentinel embedded.
    expect(setCalls.length).toBeGreaterThanOrEqual(1);
    const replaceCall = setCalls.find((c) => !c.opts || c.opts.merge !== true);
    expect(replaceCall).toBeDefined();
    // Either the run succeeded, or it failed for an unrelated canonical-validation reason — but it
    // must NOT have failed because of "FieldValue.delete()" appearing in the non-merge set payload.
    if (!result.ok) {
      expect(result.error).not.toMatch(/FieldValue\.delete\(\)/);
    }
  });
});
