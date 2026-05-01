import { describe, expect, it, vi } from "vitest";

type FirestoreSnap = { exists: boolean; data: () => any };
type FirestoreDoc = { get: () => Promise<FirestoreSnap>; collection: (name: string) => FirestoreCollection };
type FirestoreCollection = { doc: (id: string) => FirestoreDoc };
type FirestoreDb = { collection: (name: string) => FirestoreCollection };

function buildDbWithDoc(pathToDoc: Record<string, any | null>): FirestoreDb {
  const getValue = (key: string) =>
    Object.prototype.hasOwnProperty.call(pathToDoc, key) ? pathToDoc[key] : null;
  const buildCollection = (prefix: string): FirestoreCollection => ({
    doc: (id: string) => {
      const key = prefix ? `${prefix}/${id}` : id;
      return {
        get: async () => {
          const value = getValue(key);
          return {
            exists: value != null,
            data: () => value
          };
        },
        collection: (name: string) => buildCollection(`${key}/${name}`)
      };
    }
  });
  return {
    collection: (name: string) => buildCollection(name)
  };
}

vi.mock("../../repositories/source-of-truth/firestore-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const empty = buildDbWithDoc({});
  return {
    ...actual,
    getFirestoreSourceClient: vi.fn(() => empty)
  };
});

import { createApp } from "../../app/createApp.js";

describe("v2 legends after-post", () => {
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal"
  };

  it("returns processing when legendPostResults doc missing", async () => {
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockImplementation(() => buildDbWithDoc({}));

    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/legends/after-post/post_123",
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("processing");
    expect(res.json().data.awards).toEqual([]);
    expect(res.json().data.pollAfterMs).toBeGreaterThan(0);
  });

  it("returns complete + awards from legendPostResults", async () => {
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockImplementation(() =>
      buildDbWithDoc({
        "legendPostResults/post_abc": {
          postId: "post_abc",
          userId: "u1",
          status: "complete",
          awards: [
            {
              awardId: "a1",
              awardType: "new_leader",
              scopeId: "cell:geohash6:drt2yz",
              scopeType: "cell",
              title: "Local Legend",
              subtitle: "Cell drt2yz",
              postId: "post_abc",
              previousRank: null,
              newRank: 1,
              userCount: 3,
              leaderCount: 3,
              deltaToLeader: 0,
              createdAt: null,
              seen: false
            }
          ]
        }
      })
    );

    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/legends/after-post/post_abc",
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("complete");
    expect(res.json().data.awards.length).toBe(1);
    expect(res.json().data.awards[0].awardId).toBe("a1");
    expect(res.json().data.pollAfterMs).toBe(0);
  });

  it("returns xp settled payload + celebration from achievements award doc", async () => {
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockImplementation(() =>
      buildDbWithDoc({
        "legendPostResults/post_xp": {
          postId: "post_xp",
          userId: "internal-viewer",
          status: "processing",
          awards: []
        },
        "users/internal-viewer/achievements_awards/post_xp": {
          xp: 50,
          delta: {
            xpGained: 50,
            newTotalXP: 550,
            leaguePassCelebration: {
              shouldShow: true,
              leaderboardKey: "xp_global",
              previousRank: 15,
              newRank: 12,
              peoplePassed: 3,
              celebrationId: "c_1",
              createdAtMs: 1
            }
          }
        }
      })
    );
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/legends/after-post/post_xp",
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.xpSettled).toBe(true);
    expect(res.json().data.xpDelta).toBe(50);
    expect(res.json().data.leaguePassCelebration?.celebrationId).toBe("c_1");
  });
});

