import { describe, expect, it } from "vitest";
import { classifyDescription } from "../../src/lib/posts/description-cleanup/descriptionClassifier.js";

const emptyDoc = {};

function c(
  description: string,
  extra: Partial<Parameters<typeof classifyDescription>[0]> = {},
): ReturnType<typeof classifyDescription> {
  return classifyDescription({
    description,
    title: extra.title ?? "",
    activities: extra.activities ?? [],
    location: extra.location ?? "",
    mediaAssets: extra.mediaAssets ?? [],
    source: extra.source ?? "user",
    importedFrom: extra.importedFrom ?? null,
    postDoc: extra.postDoc ?? emptyDoc,
  });
}

describe("classifyDescription", () => {
  it("removes dash-assembled title/activity/place/filename strings", () => {
    const r = c("Sunset - hiking, views - Vermont - IMG_1234.jpg", {
      title: "Sunset",
      activities: ["hiking", "views"],
      location: "Vermont",
    });
    expect(r.action).toBe("remove");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("removes templated Title/Activities/Place/Asset lines", () => {
    const r = c("Title: Sunset Point Activities: Hiking Place: Vermont Asset: commons_file.jpg", {
      title: "Sunset Point",
      activities: ["Hiking"],
      location: "Vermont",
    });
    expect(r.action).toBe("remove");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("removes commons file URLs", () => {
    const r = c("commons.wikimedia.org/wiki/File:Something.jpg", {});
    expect(r.action).toBe("remove");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("keeps first-person experiential text", () => {
    const r = c("Had such an unreal sunset here with my friends", { title: "Sunset" });
    expect(r.action).toBe("keep");
    expect(r.confidence).toBeLessThan(0.45);
  });

  it("keeps normal human sentence without junk signals", () => {
    const r = c("Great little trail near campus, view was insane", {
      title: "Campus hike",
      activities: ["hiking"],
    });
    expect(r.action).toBe("keep");
  });

  it("reviews short non-obvious activity-like blurbs", () => {
    const r = c("Hiking Vermont sunset", {
      title: "Adventure",
      activities: ["hiking"],
      location: "Vermont",
    });
    expect(r.action).toBe("review");
    expect(r.confidence).toBeGreaterThanOrEqual(0.45);
    expect(r.confidence).toBeLessThan(0.85);
  });

  it("keeps empty description as no-op", () => {
    const r = c("   ", {});
    expect(r.action).toBe("keep");
    expect(r.confidence).toBe(0);
  });

  it("removes imported filename descriptions", () => {
    const r = c("DSC_0001.jpg", {
      source: "imported",
      title: "Lake",
      activities: [],
      location: "",
      mediaAssets: ["DSC_0001.jpg"],
    });
    expect(r.action).toBe("remove");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("keeps user source with normal sentence", () => {
    const r = c("We spent the whole afternoon wandering the shoreline.", { source: "user" });
    expect(r.action).toBe("keep");
  });

  it("reviews description that only equals title for user posts", () => {
    const r = c("Quiet morning", { title: "Quiet morning", source: "user" });
    expect(r.action).toBe("review");
  });
});
