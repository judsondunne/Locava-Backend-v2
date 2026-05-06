import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { encodeFirestoreTimestampsInPostWrite } from "./encodeFirestoreTimestampsInPostWrite.js";

describe("encodeFirestoreTimestampsInPostWrite", () => {
  it("converts ISO time and lifecycle strings to Firestore Timestamp instances", () => {
    const out = encodeFirestoreTimestampsInPostWrite({
      id: "p1",
      time: "2026-05-05T20:10:50.139Z",
      updatedAt: "2026-05-05T21:00:00.000Z",
      lifecycle: {
        status: "active",
        isDeleted: false,
        deletedAt: null,
        createdAt: "2026-05-05T20:10:50.139Z",
        createdAtMs: 1_777_333_000_000,
        updatedAt: "2026-05-05T21:00:00.000Z",
        lastMediaUpdatedAt: null,
        lastUserVisibleAt: null
      },
      engagementPreview: {
        recentLikers: [{ userId: "u1", likedAt: "2026-05-05T22:00:00.000Z" }],
        recentComments: [{ commentId: "c1", createdAt: "2026-05-05T23:00:00.000Z" }]
      }
    });

    expect(out.time).toBeInstanceOf(Timestamp);
    expect(out.updatedAt).toBeInstanceOf(Timestamp);
    const lc = out.lifecycle as Record<string, unknown>;
    expect(lc.createdAt).toBeInstanceOf(Timestamp);
    expect(lc.updatedAt).toBeInstanceOf(Timestamp);
    const ep = out.engagementPreview as { recentLikers: unknown[]; recentComments: unknown[] };
    expect((ep.recentLikers[0] as { likedAt: unknown }).likedAt).toBeInstanceOf(Timestamp);
    expect((ep.recentComments[0] as { createdAt: unknown }).createdAt).toBeInstanceOf(Timestamp);
  });

  it("leaves createdAtMs numeric field unchanged", () => {
    const out = encodeFirestoreTimestampsInPostWrite({
      lifecycle: {
        status: "active",
        isDeleted: false,
        deletedAt: null,
        createdAt: "2026-05-05T20:10:50.139Z",
        createdAtMs: 1_777_333_000_000,
        updatedAt: null,
        lastMediaUpdatedAt: null,
        lastUserVisibleAt: null
      }
    });
    const lc = out.lifecycle as Record<string, unknown>;
    expect(lc.createdAtMs).toBe(1_777_333_000_000);
  });
});
