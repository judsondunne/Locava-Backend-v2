import { afterEach, describe, expect, it, vi } from "vitest";
import { globalCache } from "../../cache/global-cache.js";
import * as firestoreClient from "./firestore-client.js";
import { FeedFirestoreAdapter } from "./feed-firestore.adapter.js";

function buildPostDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

describe("feed firestore adapter following feed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads following candidates from the viewer doc without calling select() on a document reference", async () => {
    const posts = [
      buildPostDoc("post-2", {
        userId: "author-b",
        time: 1_714_000_002,
        createdAtMs: 1_714_000_002_000,
        updatedAtMs: 1_714_000_002_000,
        displayPhotoLink: "https://example.com/post-2.jpg",
        mediaType: "image",
      }),
      buildPostDoc("post-1", {
        userId: "author-a",
        time: 1_714_000_001,
        createdAtMs: 1_714_000_001_000,
        updatedAtMs: 1_714_000_001_000,
        displayPhotoLink: "https://example.com/post-1.jpg",
        mediaType: "image",
      }),
    ];

    const db = {
      collection: (name: string) => {
        if (name === "users") {
          return {
            doc: (_viewerId: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  following: ["author-a", "author-b"],
                }),
              }),
              collection: (sub: string) => {
                if (sub === "feed") {
                  return {
                    orderBy: (_field: string, _dir: string) => ({
                      limit: (_limit: number) => ({
                        get: async () => ({
                          size: 0,
                          docs: [],
                        }),
                      }),
                    }),
                  };
                }
                if (sub === "following") {
                  return {
                    limit: (_limit: number) => ({
                      get: async () => ({
                        size: 2,
                        docs: [{ id: "author-a" }, { id: "author-b" }],
                      }),
                    }),
                  };
                }
                throw new Error(`unexpected_subcollection:${sub}`);
              },
            }),
          };
        }
        if (name === "posts") {
          return {
            where: (_field: string, _op: string, ids: string[]) => ({
              orderBy: (_orderField: string, _dir: string) => ({
                select: (..._fields: string[]) => ({
                  limit: (limit: number) => ({
                    get: async () => ({
                      size: Math.min(limit, posts.length),
                      docs: posts
                        .filter((doc) => ids.includes(String(doc.data().userId ?? "")))
                        .slice(0, limit),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected_collection:${name}`);
      },
    };

    vi.spyOn(firestoreClient, "getFirestoreSourceClient").mockReturnValue(db as never);
    vi.spyOn(globalCache, "get").mockResolvedValue(undefined);
    vi.spyOn(globalCache, "set").mockResolvedValue(undefined);

    const adapter = new FeedFirestoreAdapter();
    const page = await adapter.getFeedCandidatesPage({
      viewerId: "viewer-1",
      tab: "following",
      cursorOffset: 0,
      limit: 5,
    });

    expect(page.items.map((item) => item.postId)).toEqual(["post-2", "post-1"]);
    expect(page.items.map((item) => item.authorId)).toEqual(["author-b", "author-a"]);
  });
});
