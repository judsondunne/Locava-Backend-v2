import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app/createApp.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

type FirestoreSnap = { exists: boolean; data: () => any; id?: string; get?: (k: string) => any };
type FirestoreDoc = { set: (...args: any[]) => Promise<void> };
type FirestoreQuery = { get: () => Promise<{ docs: Array<{ id: string; data: () => any }> }> };
type FirestoreCollection = {
  doc: (id: string) => FirestoreDoc;
  where: () => { orderBy: () => { limit: () => FirestoreQuery } };
};
type FirestoreDb = { collection: (name: string) => any };

function buildDbWithUnseenEvents(events: any[]): FirestoreDb {
  return {
    collection: (name: string) => {
      if (name !== "users") return { doc: () => ({}) };
      return {
        doc: (_userId: string) => ({
          collection: (sub: string) => {
            if (sub !== "legendEvents") return {};
            return {
              doc: (_id: string) => ({
                set: async () => {},
              }),
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    get: async () => ({
                      docs: events.map((e, idx) => ({ id: e.eventId ?? `e${idx}`, data: () => e })),
                    }),
                  }),
                }),
              }),
            };
          },
        }),
      };
    },
  };
}

vi.mock("../../repositories/source-of-truth/firestore-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getFirestoreSourceClient: vi.fn(() =>
      buildDbWithUnseenEvents([
        {
          eventId: "evt1",
          eventType: "overtaken",
          scopeId: "activity:waterfall",
          scopeType: "activity",
          scopeTitle: "Waterfall Legend",
          previousRank: 1,
          newRank: 2,
          previousLeaderCount: 3,
          newLeaderCount: 4,
          viewerCount: 3,
          deltaToReclaim: 2,
          overtakenByUserId: "u2",
          sourcePostId: "post1",
          seen: false,
        },
      ])
    ),
  };
});

describe("v2 legends events routes", () => {
  const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const viewerHeaders = {
    "x-viewer-id": "internal-viewer",
    "x-viewer-roles": "internal",
  };

  it("returns unseen events bounded", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v2/legends/events/unseen",
      headers: viewerHeaders,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json().data;
    expect(json.routeName).toBe("legends.events.unseen.get");
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events[0].eventId).toBe("evt1");
  });

  it("marks event seen", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v2/legends/events/evt1/seen",
      headers: viewerHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.routeName).toBe("legends.events.seen.post");
    expect(res.json().data.eventId).toBe("evt1");
    expect(res.json().data.seen).toBe(true);
  });

  it("falls back gracefully when unseen query needs missing index", async () => {
    const mocked = vi.mocked(getFirestoreSourceClient);
    mocked.mockImplementationOnce(
      () => buildDbWithUnseenEvents([]) as any
    );
    const failingDb: FirestoreDb = {
      collection: (name: string) => {
        if (name !== "users") return { doc: () => ({}) };
        return {
          doc: () => ({
            collection: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: () => ({
                    get: async () => {
                      throw new Error("FAILED_PRECONDITION: missing index");
                    }
                  })
                })
              })
            })
          })
        };
      }
    };
    mocked.mockImplementationOnce(() => failingDb as unknown as any);
    const res = await app.inject({
      method: "GET",
      url: "/v2/legends/events/unseen",
      headers: viewerHeaders
    });
    expect(res.statusCode).toBe(200);
    const json = res.json().data;
    expect(json.events).toEqual([]);
    expect(json.nextPollAfterMs).toBe(60000);
    expect(json.degraded).toBe(true);
  });

});
