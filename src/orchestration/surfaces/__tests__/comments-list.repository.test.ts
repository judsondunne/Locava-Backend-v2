import { beforeEach, describe, expect, it, vi } from "vitest";

let fakeDb: unknown = null;

vi.mock("../../../repositories/source-of-truth/firestore-client.js", () => ({
  getFirestoreSourceClient: () => fakeDb
}));

type PostDoc = Record<string, unknown>;
type CommentDoc = Record<string, unknown>;

function buildDb(post: PostDoc, subcollection: CommentDoc[] = []) {
  return {
    collection(name: string) {
      expect(name).toBe("posts");
      return {
        doc(postId: string) {
          return {
            async get() {
              return {
                exists: true,
                data: () => ({ id: postId, ...post })
              };
            },
            collection(childName: string) {
              expect(childName).toBe("comments");
              return {
                async get() {
                  return {
                    size: subcollection.length,
                    docs: subcollection.map((row, index) => ({
                      id: String(row.id ?? row.commentId ?? `sub-${index}`),
                      data: () => row
                    }))
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

function row(id: string, text = "hello"): CommentDoc {
  return {
    id,
    content: text,
    userId: "user-1",
    userName: "User One",
    createdAtMs: 1_775_933_114_148
  };
}

async function list(post: PostDoc, subcollection: CommentDoc[] = []) {
  fakeDb = buildDb(post, subcollection);
  const { CommentsRepository } = await import("../../../repositories/surfaces/comments.repository.js");
  const repo = new CommentsRepository();
  repo.resetForTests();
  return repo.listTopLevelComments({
    viewerId: "viewer-1",
    postId: "post-with-comments",
    cursor: null,
    limit: 10
  });
}

describe("comments list repository source resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    fakeDb = null;
  });

  it("returns subcollection rows when commentCount is positive", async () => {
    const page = await list({ commentCount: 1 }, [row("sub-1", "from subcollection")]);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.text).toBe("from subcollection");
    expect(page.sourceDebug.sourceUsed).toBe("subcollection");
    expect(page.sourceDebug.contractMismatch).toBe(false);
  });

  it("returns embedded comments rows when present", async () => {
    const page = await list({ commentCount: 1, comments: [row("embedded-1", "from embedded")] });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.commentId).toBe("embedded-1");
    expect(page.sourceDebug.sourceUsed).toBe("embedded_comments");
  });

  it("does not short-circuit on empty embedded comments when subcollection has rows", async () => {
    const page = await list({ commentCount: 1, comments: [] }, [row("sub-2", "real row")]);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.commentId).toBe("sub-2");
    expect(page.sourceDebug.embeddedCount).toBe(0);
    expect(page.sourceDebug.subcollectionCount).toBe(1);
  });

  it("returns a contract mismatch when count is positive and no row source exists", async () => {
    const page = await list({ commentCount: 1, comments: [] });

    expect(page.items).toHaveLength(0);
    expect(page.totalCount).toBe(1);
    expect(page.sourceDebug.contractMismatch).toBe(true);
    expect(page.sourceDebug.sourceUsed).toBe("none");
  });

  it("returns preview rows when only commentsPreview exists", async () => {
    const page = await list({
      commentsCount: 1,
      commentsPreview: [{ commentId: "preview-1", text: "from preview", displayName: "Preview User" }]
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.commentId).toBe("preview-1");
    expect(page.items[0]?.text).toBe("from preview");
    expect(page.items[0]?.preview).toBe(true);
    expect(page.sourceDebug.sourceUsed).toBe("comments_preview");
  });

  it("returns engagementPreview recentComments rows when commentsPreview is absent", async () => {
    const page = await list({
      engagement: { commentCount: 1 },
      engagementPreview: {
        recentComments: [{
          commentId: "recent-1",
          text: "Sus",
          displayName: "Will",
          createdAt: "2026-04-11T18:45:14.148Z"
        }]
      }
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.commentId).toBe("recent-1");
    expect(page.items[0]?.author.name).toBe("Will");
    expect(page.items[0]?.createdAtMs).toBe(Date.parse("2026-04-11T18:45:14.148Z"));
    expect(page.sourceDebug.sourceUsed).toBe("engagement_preview");
  });
});
