import { describe, expect, it, beforeEach } from "vitest";
import { buildExistingMediaDiagnostics } from "../../lib/inventory/media/inventoryExistingMediaDiagnostics.js";
import type { ExistingMediaCatalogItem } from "../../lib/inventory/media/inventoryExistingMediaDiagnostics.js";
import {
  putExistingMediaBundle,
  resetExistingMediaBundleForTests,
  searchExistingMedia,
} from "./inventoryExistingMedia.service.js";

function sampleItem(overrides: Partial<ExistingMediaCatalogItem> = {}): ExistingMediaCatalogItem {
  return {
    decision: "accepted",
    kind: "spot",
    name: "French's Ledges",
    displayName: "French's Ledges",
    category: "viewpoint",
    activity: null,
    sourceKey: "node/100",
    tags: { wikimedia_commons: "File:Example.jpg" },
    existingMediaRefs: [
      {
        id: "1",
        sourceKey: "node/100",
        tagKey: "wikimedia_commons",
        rawValue: "File:Example.jpg",
        mediaKind: "commons_file",
        canPreview: true,
        previewUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg?width=800",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
        label: "File:Example.jpg",
        confidence: "high",
        notes: [],
        requiresLaterResolution: false,
      },
    ],
    existingMediaRefCount: 1,
    previewableMediaCount: 1,
    commonsFileCount: 1,
    commonsCategoryCount: 0,
    wikidataMediaClue: false,
    wikipediaMediaClue: false,
    mapillaryMediaClue: false,
    websiteMediaClue: false,
    ...overrides,
  };
}

describe("inventoryExistingMedia.service search", () => {
  beforeEach(() => {
    resetExistingMediaBundleForTests();
    const items = [
      sampleItem(),
      sampleItem({
        name: "No Media Spot",
        displayName: "No Media Spot",
        sourceKey: "node/200",
        tags: {},
        existingMediaRefs: [],
        existingMediaRefCount: 0,
        previewableMediaCount: 0,
        commonsFileCount: 0,
      }),
      sampleItem({
        decision: "rejected",
        kind: "spot",
        name: "Rejected Beach",
        displayName: "Rejected Beach",
        sourceKey: "node/300",
        category: "beach",
        tags: { wikipedia: "en:Beach" },
        existingMediaRefs: [
          {
            id: "2",
            sourceKey: "node/300",
            tagKey: "wikipedia",
            rawValue: "en:Beach",
            mediaKind: "wikipedia",
            canPreview: false,
            sourceUrl: "https://en.wikipedia.org/wiki/Beach",
            label: "Beach",
            confidence: "medium",
            notes: [],
            requiresLaterResolution: true,
          },
        ],
        existingMediaRefCount: 1,
        previewableMediaCount: 0,
        commonsFileCount: 0,
        wikipediaMediaClue: true,
      }),
    ];
    putExistingMediaBundle({
      runId: "run-test",
      dataSource: "openstreetmap_classification",
      items,
      diagnostics: buildExistingMediaDiagnostics({
        runId: "run-test",
        dataSource: "openstreetmap_classification",
        items,
      }),
    });
  });

  it("admin search can filter hasMediaRef=true", () => {
    const result = searchExistingMedia({ hasMediaRef: true });
    expect(result).not.toBeNull();
    expect(result!.total).toBe(2);
    expect(result!.results.every((r) => r.existingMediaRefCount > 0)).toBe(true);
  });

  it("admin search can filter mediaKind=commons_file", () => {
    const result = searchExistingMedia({ mediaKind: "commons_file" });
    expect(result!.total).toBe(1);
    expect(result!.results[0]?.sourceKey).toBe("node/100");
  });

  it("search by place name finds items", () => {
    const result = searchExistingMedia({ q: "french" });
    expect(result!.total).toBe(1);
  });

  it("includeRejected=false excludes rejected", () => {
    const result = searchExistingMedia({ includeRejected: false });
    expect(result!.results.every((r) => r.decision === "accepted")).toBe(true);
  });

  it("diagnostics JSON includes existingMediaDiagnostics shape", () => {
    const diag = buildExistingMediaDiagnostics({
      runId: "run-test",
      dataSource: "openstreetmap_classification",
      items: [sampleItem()],
    });
    expect(diag.algorithmVersion).toBe("locava_existing_media_refs_v1");
    expect(diag.noApiCalls).toBe(true);
    expect(diag.noRefetch).toBe(true);
    expect(diag.counts.itemsWithCommonsFile).toBe(1);
  });
});

describe("existing media feature safety", () => {
  it("no code performs external API calls in media modules", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const files = [
      "src/lib/inventory/media/inventoryExistingMediaRefs.ts",
      "src/lib/inventory/media/inventoryExistingMediaDiagnostics.ts",
      "src/admin/inventory/inventoryExistingMedia.service.ts",
    ];
    for (const rel of files) {
      const content = await fs.readFile(path.join(process.cwd(), rel), "utf8");
      expect(content).not.toMatch(/\bfetch\s*\(/);
      expect(content).not.toMatch(/axios|wikimedia\.org\/w\/api|wikidata\.org\/w\/api/);
    }
  });

  it("no code writes to Firestore or /posts in media modules", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const files = [
      "src/lib/inventory/media/inventoryExistingMediaRefs.ts",
      "src/admin/inventory/inventoryExistingMedia.service.ts",
    ];
    for (const rel of files) {
      const content = await fs.readFile(path.join(process.cwd(), rel), "utf8");
      expect(content).not.toMatch(/\/posts|firestore|\.set\(|\.update\(/i);
    }
  });
});
