import { describe, expect, it, vi } from "vitest";
import {
  buildRestorePreviewFromCanonicalBackupReadOnly,
  parseBackupDocId,
  toFirestoreTimestamp
} from "../../lib/emergency/buildRestorePreviewFromCanonicalBackupReadOnly.js";
import { Timestamp } from "firebase-admin/firestore";

type AnyRecord = Record<string, unknown>;

type MockState = {
  backups: Map<string, AnyRecord>;
  posts: Map<string, AnyRecord>;
  setCalls: Array<{ collection: string; id: string; data: AnyRecord; options: unknown }>;
  subcollectionsTouched: string[];
};

function isTimestampLike(value: unknown): boolean {
  if (value instanceof Timestamp) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as { _seconds?: unknown; _nanoseconds?: unknown; seconds?: unknown; nanoseconds?: unknown };
  return typeof v._seconds === "number" || typeof v.seconds === "number";
}

const firestoreMockState = vi.hoisted(() => ({
  db: null as any,
  state: null as MockState | null
}));

function buildMockDb(seed: { backups?: Record<string, AnyRecord>; posts?: Record<string, AnyRecord> }) {
  const state: MockState = {
    backups: new Map(Object.entries(seed.backups ?? {})),
    posts: new Map(Object.entries(seed.posts ?? {})),
    setCalls: [],
    subcollectionsTouched: []
  };
  const db = {
    batch() {
      const ops: Array<() => Promise<void>> = [];
      return {
        set(ref: { set: (data: AnyRecord, opts: unknown) => Promise<void> }, data: AnyRecord, opts: unknown) {
          ops.push(() => ref.set(data, opts));
        },
        async commit() {
          for (const op of ops) await op();
        }
      };
    },
    collection(name: string) {
      const getDocs = async (limit = 1000, startAfterId?: string) => {
        const source = name === "postCanonicalBackups" ? state.backups : state.posts;
        const keys = Array.from(source.keys()).sort();
        const filtered = startAfterId ? keys.filter((k) => k > startAfterId) : keys;
        return filtered.slice(0, limit).map((id) => ({ id, data: () => structuredClone(source.get(id) ?? {}), exists: source.has(id) }));
      };
      return {
        orderBy() {
          return {
            limit(limit: number) {
              return {
                async get() {
                  const docs = await getDocs(limit);
                  return { docs, size: docs.length };
                },
                startAfter(cursor: string) {
                  return {
                    async get() {
                      const docs = await getDocs(limit, cursor);
                      return { docs, size: docs.length };
                    }
                  };
                }
              };
            }
          };
        },
        doc(id: string) {
          return {
            async get() {
              const source = name === "postCanonicalBackups" ? state.backups : state.posts;
              const value = source.get(id);
              return {
                exists: value !== undefined,
                data: () => (value === undefined ? null : structuredClone(value)),
                ref: {
                  collection(subName: string) {
                    state.subcollectionsTouched.push(`${name}/${id}/${subName}`);
                    return {
                      count() {
                        return {
                          async get() {
                            return { data: () => ({ count: 0 }) };
                          }
                        };
                      }
                    };
                  }
                }
              };
            },
            async set(data: AnyRecord, options: unknown) {
              state.setCalls.push({ collection: name, id, data: structuredClone(data), options });
              if (name === "posts") {
                const merge = Boolean((options as { merge?: boolean } | undefined)?.merge);
                if (merge) {
                  const prior = state.posts.get(id) ?? {};
                  state.posts.set(id, { ...(prior as AnyRecord), ...structuredClone(data) });
                } else {
                  state.posts.set(id, structuredClone(data));
                }
              }
            },
            async update() {
              throw new Error("update_not_allowed_in_test");
            },
            async delete() {
              throw new Error("delete_not_allowed_in_test");
            }
          };
        }
      };
    }
  };
  return { db, state };
}

vi.mock("../../repositories/source-of-truth/firestore-client.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getFirestoreSourceClient: vi.fn(() => firestoreMockState.db),
    getFirestoreAdminIdentity: vi.fn(() => ({
      projectId: "learn-32d72",
      credentialType: "test",
      serviceAccountEmail: null,
      credentialsLoaded: true,
      credentialPath: null
    }))
  };
});

import { createApp } from "../../app/createApp.js";

const backupDocId = "FNM5327GjX7VOI7wUXGW_1778036149336";
const postId = "FNM5327GjX7VOI7wUXGW";
const knownCompactLivePost: AnyRecord = {
  id: postId,
  postId,
  media: { assets: [{ type: "image" }] },
  text: { title: "Mother natures shower" },
  author: { handle: "calvin", userId: "u1" },
  location: { display: { name: "Test" } },
  lifecycle: { status: "live" },
  classification: { mediaKind: "image" },
  compatibility: { stub: true },
  engagement: { likes: 19, comments: 0 },
  engagementPreview: { likes: 19, comments: 0 },
  schema: { version: "v2" }
};

describe("restore preview builder", () => {
  it("converts {_seconds,_nanoseconds} and ISO strings to Timestamp", () => {
    const a = toFirestoreTimestamp({ _seconds: 1778036149, _nanoseconds: 336000000 });
    const b = toFirestoreTimestamp("2026-04-11T21:19:02.918Z");
    expect(a).toBeInstanceOf(Timestamp);
    expect(b).toBeInstanceOf(Timestamp);
  });

  it("infers post id from backup doc id", () => {
    const parsed = parseBackupDocId(backupDocId);
    expect(parsed.postId).toBe(postId);
    expect(parsed.timestampMs).toBe(1778036149336);
  });

  it("accepts object media with assets and stays valid", () => {
    const preview = buildRestorePreviewFromCanonicalBackupReadOnly({
      projectId: "learn-32d72",
      backupDocId,
      backupData: { compactLivePost: knownCompactLivePost },
      currentPostExists: false,
      currentPostData: null,
      backupField: "compactLivePost",
      allowOverwrite: false,
      previewIsoTimestamp: "2026-05-06T12:00:00.000Z"
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.validation.valid).toBe(true);
    expect(preview.validation.checks.hasMedia).toBe(true);
    expect(preview.validation.checks.hasMediaAssets).toBe(true);
  });
});

describe("restore preview + apply-one routes", () => {
  it("preview is read-only and does not write", async () => {
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/restore-preview?backupField=compactLivePost`
      });
      expect(res.statusCode).toBe(200);
      expect(state.setCalls.length).toBe(0);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.NO_FIRESTORE_WRITE_PERFORMED).toBe("NO_FIRESTORE_WRITE_PERFORMED");
      expect(body.wrote).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("bulk apply refuses without exact confirmation", async () => {
    const { db } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } }
    });
    firestoreMockState.db = db;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/debug/post-canonical-backups/bulk-restore/apply",
        payload: { limit: 1, source: "auto", restorePolicy: "missing_or_empty_only" }
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.error).toBe("CONFIRMATION_REQUIRED");
      expect(body.wroteCount).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("apply-one refuses invalid backup doc", async () => {
    const { db } = buildMockDb({});
    firestoreMockState.db = db;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/debug/post-canonical-backups/missing_1/apply-one",
        payload: { backupField: "compactLivePost", confirmation: "I_UNDERSTAND_RESTORE_POSTS", allowOverwrite: false }
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.wrote).toBe(false);
      expect(body.error).toBe("backup_doc_not_found");
    } finally {
      await app.close();
    }
  });

  it("apply-one validates compactLivePost before write", async () => {
    const invalidBackup = {
      compactLivePost: {
        id: postId,
        postId,
        media: {},
        author: { handle: "x" },
        lifecycle: { status: "live" },
        classification: { mediaKind: "image" },
        compatibility: { stub: true }
      }
    };
    const { db, state } = buildMockDb({ backups: { [backupDocId]: invalidBackup } });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/apply-one`,
        payload: { backupField: "compactLivePost", confirmation: "I_UNDERSTAND_RESTORE_POSTS", allowOverwrite: false }
      });
      expect(res.statusCode).toBe(422);
      expect(state.setCalls.length).toBe(0);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.error).toBe("VALIDATION_FAILED");
      expect(body.wrote).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("apply-one writes only posts/{postId} parent doc when missing", async () => {
    const { db, state } = buildMockDb({
      backups: {
        [backupDocId]: {
          compactLivePost: knownCompactLivePost,
          rawBefore: {
            time: { _seconds: 1778036149, _nanoseconds: 336000000 },
            updatedAt: { _seconds: 1778036200, _nanoseconds: 0 },
            lastUpdated: { _seconds: 1778036201, _nanoseconds: 0 }
          }
        }
      }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/apply-one`,
        payload: { backupField: "compactLivePost", confirmation: "I_UNDERSTAND_RESTORE_POSTS", allowOverwrite: false }
      });
      expect(res.statusCode).toBe(200);
      expect(state.setCalls.length).toBe(1);
      expect(state.setCalls[0]?.collection).toBe("posts");
      expect(state.setCalls[0]?.id).toBe(postId);
      expect(isTimestampLike(state.setCalls[0]?.data.time)).toBe(true);
      expect(isTimestampLike(state.setCalls[0]?.data.updatedAt)).toBe(true);
      expect(isTimestampLike((state.setCalls[0]?.data.schema as AnyRecord)?.restoredAt)).toBe(true);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.wrote).toBe(true);
      expect(body.targetPath).toBe(`posts/${postId}`);
    } finally {
      await app.close();
    }
  });

  it("apply-one does not touch subcollections", async () => {
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      await app.inject({
        method: "POST",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/apply-one`,
        payload: { backupField: "compactLivePost", confirmation: "I_UNDERSTAND_RESTORE_POSTS", allowOverwrite: false }
      });
      expect(state.subcollectionsTouched.length).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("apply-one skips existing parent with data when allowOverwrite=false", async () => {
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } },
      posts: { [postId]: { userId: "existing-user", title: "Already restored" } }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/apply-one`,
        payload: { backupField: "compactLivePost", confirmation: "I_UNDERSTAND_RESTORE_POSTS", allowOverwrite: false }
      });
      expect(res.statusCode).toBe(409);
      expect(state.setCalls.length).toBe(0);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.wrote).toBe(false);
      expect((body.decision as AnyRecord).writeMode).toBe("skip_existing_doc");
    } finally {
      await app.close();
    }
  });

  it("apply-one normalizes id/postId and adds schema restore metadata", async () => {
    const backupWithoutIds = {
      compactLivePost: {
        ...knownCompactLivePost,
        id: "",
        postId: "",
        schema: { version: "v2" }
      }
    };
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: backupWithoutIds }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/apply-one`,
        payload: { backupField: "compactLivePost", confirmation: "I_UNDERSTAND_RESTORE_POSTS", allowOverwrite: false }
      });
      expect(res.statusCode).toBe(200);
      const write = state.setCalls[0]?.data ?? {};
      expect(write.id).toBe(postId);
      expect(write.postId).toBe(postId);
      const schema = (write.schema ?? {}) as AnyRecord;
      expect(schema.restoredFromCanonicalBackup).toBe(true);
      expect(schema.restoreBackupDocId).toBe(backupDocId);
      expect(isTimestampLike(schema.restoredAt)).toBe(true);
      expect(schema.restorePreviewOnly).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("apply-one response wrote=true only when set happened", async () => {
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/apply-one`,
        payload: { backupField: "compactLivePost", confirmation: "I_UNDERSTAND_RESTORE_POSTS", allowOverwrite: false }
      });
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(state.setCalls.length).toBe(1);
      expect(body.wrote).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("dry-run preview known backup includes expected preview values", async () => {
    const { db } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } }
    });
    firestoreMockState.db = db;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "GET",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/restore-preview?backupField=compactLivePost&allowOverwrite=false`
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.inferredPostId).toBe(postId);
      expect(body.backupFieldUsed).toBe("compactLivePost");
      expect(body.wrote).toBe(false);
      expect(body.readOnly).toBe(true);
      expect(body.dryRun).toBe(true);
      expect(body.NO_FIRESTORE_WRITE_PERFORMED).toBe("NO_FIRESTORE_WRITE_PERFORMED");
      const preview = body.restorePayloadPreview as AnyRecord;
      expect(preview.id).toBe(postId);
      expect(((preview.media as AnyRecord).assets as Array<AnyRecord>)[0]?.type).toBe("image");
      expect((preview.text as AnyRecord).title).toBe("Mother natures shower");
      expect((preview.author as AnyRecord).handle).toBe("calvin");
    } finally {
      await app.close();
    }
  });

  it("bulk preview is read-only", async () => {
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "GET",
        url: "/debug/post-canonical-backups/bulk-restore/preview?limit=1&source=auto&restorePolicy=missing_or_empty_only"
      });
      expect(res.statusCode).toBe(200);
      expect(state.setCalls.length).toBe(0);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.dryRun).toBe(true);
      expect(body.wrote).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("bulk apply writes missing parent docs only", async () => {
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: { compactLivePost: knownCompactLivePost } }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/debug/post-canonical-backups/bulk-restore/apply",
        payload: {
          limit: 1,
          source: "auto",
          restorePolicy: "missing_or_empty_only",
          confirmation: "I_UNDERSTAND_BULK_RESTORE_POSTS"
        }
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as AnyRecord;
      expect(body.wroteCount).toBe(1);
      expect(state.setCalls.some((c) => c.collection === "posts" && c.id === postId)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("repair-one-timestamps updates timestamp fields only", async () => {
    const existing = {
      id: postId,
      postId,
      media: { assets: [{ type: "image" }] },
      text: { title: "Mother natures shower" },
      author: { handle: "calvin", userId: "u1" },
      location: { display: { name: "Test" } },
      lifecycle: { createdAt: "2026-04-11T21:19:02.918Z", createdAtMs: 1778036149336 },
      classification: { mediaKind: "image" },
      engagement: { likes: 1, comments: 0 },
      schema: { restoredFromCanonicalBackup: true, restoredAt: "bad-string" }
    };
    const backupWithRaw = {
      compactLivePost: knownCompactLivePost,
      rawBefore: {
        time: { _seconds: 1778036149, _nanoseconds: 336000000 },
        updatedAt: { _seconds: 1778036200, _nanoseconds: 0 },
        lastUpdated: { _seconds: 1778036201, _nanoseconds: 0 }
      }
    };
    const { db, state } = buildMockDb({
      backups: { [backupDocId]: backupWithRaw },
      posts: { [postId]: existing }
    });
    firestoreMockState.db = db;
    firestoreMockState.state = state;
    const app = createApp({ NODE_ENV: "development", LOG_LEVEL: "silent" });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/debug/post-canonical-backups/${encodeURIComponent(backupDocId)}/repair-one-timestamps`,
        payload: { confirmation: "I_UNDERSTAND_REPAIR_ONE_POST_TIMESTAMPS" }
      });
      expect(res.statusCode).toBe(200);
      expect(state.setCalls.length).toBe(1);
      const write = state.setCalls[0]?.data as AnyRecord;
      expect(isTimestampLike(write.time)).toBe(true);
      expect(isTimestampLike(write.updatedAt)).toBe(true);
      expect(isTimestampLike(write.lastUpdated)).toBe(true);
      expect(isTimestampLike((write.schema as AnyRecord).restoredAt)).toBe(true);
      expect(state.subcollectionsTouched.length).toBe(0);
    } finally {
      await app.close();
    }
  });
});
