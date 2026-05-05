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

  it("returns pending when legendPostResults doc missing", async () => {
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockImplementation(() => buildDbWithDoc({}));

    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/legends/after-post/post_123",
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("pending");
    expect(res.json().data.awards).toEqual([]);
    expect(res.json().data.retryAfterMs).toBeGreaterThan(0);
  });

  it("returns ready + awards from legendPostResults", async () => {
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockImplementation(() =>
      buildDbWithDoc({
        "legendPostResults/post_abc": {
          postId: "post_abc",
          userId: "u1",
          status: "ready",
          awards: [
            {
              awardId: "a1",
              awardType: "new_leader",
              scopeId: "place:state:VT",
              scopeType: "place",
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
    expect(res.json().data.status).toBe("ready");
    expect(res.json().data.awards.length).toBe(1);
    expect(res.json().data.awards[0].awardId).toBe("a1");
    expect(res.json().data.retryAfterMs).toBe(0);
    expect(res.json().data.reasonIfEmpty).toBeNull();
    expect(res.json().data.shouldShowAwardScreen).toBe(true);
  });

  it("is idempotent for repeated after-post calls and exposes legend status", async () => {
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockImplementation(() =>
      buildDbWithDoc({
        "legendPostResults/post_repeat": {
          postId: "post_repeat",
          userId: "internal-viewer",
          status: "ready",
          awards: [
            {
              awardId: "post_repeat_place:state:PA_new_leader",
              awardType: "new_leader",
              scopeId: "placeActivity:state:PA:surfing",
              scopeType: "placeActivity",
              title: "New #1: Surfing Legend",
              subtitle: "Pennsylvania",
              postId: "post_repeat",
              previousRank: 2,
              newRank: 1,
              userCount: 3,
              leaderCount: 3,
              deltaToLeader: 0
            }
          ]
        }
      })
    );
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const first = await app.inject({
      method: "GET",
      url: "/v2/legends/after-post/post_repeat",
      headers: viewerHeaders
    });
    const second = await app.inject({
      method: "GET",
      url: "/v2/legends/after-post/post_repeat",
      headers: viewerHeaders
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().data.awards).toEqual(second.json().data.awards);
    expect(first.json().data.legendStatus.activityKey).toBe("surfing");
    expect(first.json().data.legendStatus.scopeKey).toBe("placeActivity:state:PA");
    expect(first.json().data.legendStatus.becameLegend).toBe(true);
  });

  it("returns xp settled payload + celebration from achievements award doc", async () => {
    const { getFirestoreSourceClient } = await import("../../repositories/source-of-truth/firestore-client.js");
    (getFirestoreSourceClient as any).mockImplementation(() =>
      buildDbWithDoc({
        "legendPostResults/post_xp": {
          postId: "post_xp",
          userId: "internal-viewer",
          status: "pending",
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

