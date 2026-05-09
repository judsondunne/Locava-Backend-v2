import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredDoc = Record<string, unknown>;

class MockDocSnapshot {
  constructor(private readonly value: StoredDoc | null) {}
  get exists(): boolean {
    return this.value !== null;
  }
  data(): StoredDoc | undefined {
    return this.value ?? undefined;
  }
}

class MockDocRef {
  constructor(
    private readonly store: Map<string, StoredDoc>,
    private readonly id: string
  ) {}
  async get(): Promise<MockDocSnapshot> {
    return new MockDocSnapshot(this.store.get(this.id) ?? null);
  }
  async set(value: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void> {
    const current = this.store.get(this.id) ?? {};
    this.store.set(this.id, opts?.merge ? { ...current, ...value } : { ...value });
  }
}

class MockCollection {
  constructor(private readonly store: Map<string, StoredDoc>) {}
  doc(id: string): MockDocRef {
    return new MockDocRef(this.store, id);
  }
  async get(): Promise<{ docs: Array<{ data: () => StoredDoc }> }> {
    const docs = Array.from(this.store.values()).map((row) => ({ data: () => row }));
    return { docs };
  }
}

const stagedReelsStore = new Map<string, StoredDoc>();
const firestoreMock = {
  collection: (name: string) => {
    if (name !== "stagedReels") throw new Error(`unexpected collection ${name}`);
    return new MockCollection(stagedReelsStore);
  }
};

vi.mock("../../lib/firebase-admin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/firebase-admin.js")>();
  return {
    ...actual,
    getFirebaseAdminFirestore: () => firestoreMock
  };
});

const ADMIN_UID = "aXngoh9jeqW35FNM3fq1w9aXdEh1";

describe("v2 admin staged reels routes", () => {
  beforeEach(() => {
    stagedReelsStore.clear();
    process.env.WASABI_ACCESS_KEY_ID = "test-key";
    process.env.WASABI_SECRET_ACCESS_KEY = "test-secret";
    process.env.WASABI_BUCKET_NAME = "locava.app";
    process.env.WASABI_ENDPOINT = "https://s3.us-east-1.wasabisys.com";
    process.env.WASABI_REGION = "us-east-1";
  });

  it("rejects non-admin requests", async () => {
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "GET",
      url: "/v2/admin/staged-reels",
      headers: {
        authorization: "Bearer test-user:someone-else"
      }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");
  }, 15000);

  it("validates init-upload mime type as video/*", async () => {
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    const res = await app.inject({
      method: "POST",
      url: "/v2/admin/staged-reels/init-upload",
      headers: {
        authorization: `Bearer test-admin:${ADMIN_UID}`
      },
      payload: {
        filename: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("finalize creates idempotent stagedReels shape", async () => {
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });

    const initRes = await app.inject({
      method: "POST",
      url: "/v2/admin/staged-reels/init-upload",
      headers: {
        authorization: `Bearer test-admin:${ADMIN_UID}`
      },
      payload: {
        filename: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 123456
      }
    });
    expect(initRes.statusCode).toBe(200);
    const initData = initRes.json().data;

    const payload = {
      uploadId: initData.uploadId,
      bucket: initData.bucket,
      objectKey: initData.objectKey,
      url: initData.canonicalUrl,
      media: {
        filename: "clip.mp4",
        mimeType: "video/mp4",
        sizeBytes: 123456,
        durationMs: 8000,
        width: 1080,
        height: 1920
      },
      location: {
        lat: 43.6416,
        lng: -79.3871,
        source: "manual-map",
        city: "Toronto"
      },
      client: {
        platform: "ios",
        appVersion: "1.0.0"
      }
    };

    const finalizeResA = await app.inject({
      method: "POST",
      url: "/v2/admin/staged-reels/finalize",
      headers: {
        authorization: `Bearer test-admin:${ADMIN_UID}`
      },
      payload
    });
    expect(finalizeResA.statusCode).toBe(200);
    const stagedA = finalizeResA.json().data.stagedReel;
    expect(stagedA.id).toBe(initData.uploadId);
    expect(stagedA.media.uploadId).toBe(initData.uploadId);
    expect(stagedA.location.geohash).toBeTypeOf("string");
    expect(stagedA.postDraft.title).toBe("");

    const finalizeResB = await app.inject({
      method: "POST",
      url: "/v2/admin/staged-reels/finalize",
      headers: {
        authorization: `Bearer test-admin:${ADMIN_UID}`
      },
      payload
    });
    expect(finalizeResB.statusCode).toBe(200);
    const stagedB = finalizeResB.json().data.stagedReel;
    expect(stagedB.id).toBe(stagedA.id);
  });

  it("patch only updates allowed draft/status fields", async () => {
    const { createApp } = await import("../../app/createApp.js");
    const app = createApp({ NODE_ENV: "test", LOG_LEVEL: "silent" });
    stagedReelsStore.set("upload-1", {
      id: "upload-1",
      type: "stagedReel",
      status: "staged",
      media: { objectKey: "staged-reels/a/original.mp4", uploadId: "upload-1" },
      postDraft: {
        title: "",
        description: "",
        activities: [],
        visibility: "public",
        postAsUserId: null,
        notes: ""
      }
    });
    const patchRes = await app.inject({
      method: "PATCH",
      url: "/v2/admin/staged-reels/upload-1",
      headers: {
        authorization: `Bearer test-admin:${ADMIN_UID}`
      },
      payload: {
        status: "reviewing",
        postDraft: {
          title: "Draft title",
          notes: "Some notes"
        },
        media: {
          objectKey: "attempted-overwrite.mp4"
        }
      }
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.stagedReel.media.objectKey).toBe("staged-reels/a/original.mp4");

    const goodPatch = await app.inject({
      method: "PATCH",
      url: "/v2/admin/staged-reels/upload-1",
      headers: {
        authorization: `Bearer test-admin:${ADMIN_UID}`
      },
      payload: {
        status: "reviewing",
        postDraft: {
          title: "Draft title",
          notes: "Some notes"
        }
      }
    });
    expect(goodPatch.statusCode).toBe(200);
    const staged = goodPatch.json().data.stagedReel;
    expect(staged.status).toBe("reviewing");
    expect(staged.postDraft.title).toBe("Draft title");
    expect(staged.media.objectKey).toBe("staged-reels/a/original.mp4");
  });
});
