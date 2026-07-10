import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEmbeddingConfigFromEnv } from "./post-embedding.service.js";

const KEYS = [
  "SEARCH_EMBEDDING_PROVIDER",
  "SEARCH_EMBEDDING_MODEL",
  "SEARCH_EMBEDDING_DIM",
  "SEARCH_EMBEDDING_LOCATION",
  "SEARCH_EMBEDDING_PROJECT_ID",
  "GCP_PROJECT_ID",
  "GOOGLE_CLOUD_PROJECT",
  "FIREBASE_PROJECT_ID"
] as const;

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("readEmbeddingConfigFromEnv", () => {
  it("returns null when no GCP project is configured", () => {
    expect(readEmbeddingConfigFromEnv()).toBeNull();
  });

  it("returns null for an unsupported provider (disables semantic search)", () => {
    process.env.SEARCH_EMBEDDING_PROVIDER = "voyage";
    process.env.GCP_PROJECT_ID = "proj";
    expect(readEmbeddingConfigFromEnv()).toBeNull();
  });

  it("defaults to Vertex text-embedding-005 @ 768 dims when project is present", () => {
    process.env.GCP_PROJECT_ID = "proj";
    const cfg = readEmbeddingConfigFromEnv();
    expect(cfg).toEqual({
      provider: "vertex",
      model: "text-embedding-005",
      dim: 768,
      projectId: "proj",
      location: "us-central1"
    });
  });

  it("honors explicit model/dim/location overrides and falls back through project env keys", () => {
    process.env.FIREBASE_PROJECT_ID = "fb-proj";
    process.env.SEARCH_EMBEDDING_MODEL = "text-embedding-005";
    process.env.SEARCH_EMBEDDING_DIM = "256";
    process.env.SEARCH_EMBEDDING_LOCATION = "us-east4";
    const cfg = readEmbeddingConfigFromEnv();
    expect(cfg?.projectId).toBe("fb-proj");
    expect(cfg?.dim).toBe(256);
    expect(cfg?.location).toBe("us-east4");
  });
});
