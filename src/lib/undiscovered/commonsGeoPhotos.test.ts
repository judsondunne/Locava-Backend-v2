import { describe, it, expect, vi } from "vitest";
import {
  fetchCommonsPhotosNear,
  commonsDistanceConfidence,
  commonsPhotosToCacheResults,
} from "./commonsGeoPhotos.js";

function geoPayload(files: Array<{ title: string; dist: number }>) {
  return { query: { geosearch: files } };
}
function infoPayload(pages: Array<{ title: string; url: string; thumburl?: string; artist?: string; license?: string }>) {
  const out: Record<string, unknown> = {};
  pages.forEach((p, i) => {
    out[String(i + 1)] = {
      title: p.title,
      imageinfo: [{
        url: p.url,
        thumburl: p.thumburl ?? p.url,
        descriptionurl: `https://commons.wikimedia.org/wiki/${p.title}`,
        width: 4000, height: 3000,
        extmetadata: {
          Artist: { value: p.artist ? `<a href="#">${p.artist}</a>` : undefined },
          LicenseShortName: { value: p.license },
        },
      }],
    };
  });
  return { query: { pages: out } };
}

describe("commonsDistanceConfidence", () => {
  it("scores closer photos higher", () => {
    expect(commonsDistanceConfidence(50)).toBe(75);
    expect(commonsDistanceConfidence(200)).toBe(65);
    expect(commonsDistanceConfidence(390)).toBe(55);
  });
});

describe("fetchCommonsPhotosNear", () => {
  it("returns photos nearest-first with attribution", async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes("list=geosearch")) {
        return geoPayload([
          { title: "File:Far.jpg", dist: 350 },
          { title: "File:Near.jpg", dist: 40 },
        ]);
      }
      return infoPayload([
        { title: "File:Far.jpg", url: "https://up.wiki/Far.jpg", artist: "Bob", license: "CC BY-SA 4.0" },
        { title: "File:Near.jpg", url: "https://up.wiki/Near.jpg", artist: "Ann", license: "CC0" },
      ]);
    });
    const photos = await fetchCommonsPhotosNear(44.1, -72.8, {}, { httpGetJson });
    expect(photos.map((p) => p.title)).toEqual(["File:Near.jpg", "File:Far.jpg"]);
    expect(photos[0]!.artist).toBe("Ann");
    expect(photos[0]!.license).toBe("CC0");
  });

  it("skips non-image files and empty results", async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes("list=geosearch")) return geoPayload([{ title: "File:Map.pdf", dist: 10 }]);
      return infoPayload([{ title: "File:Map.pdf", url: "https://up.wiki/Map.pdf" }]);
    });
    expect(await fetchCommonsPhotosNear(44.1, -72.8, {}, { httpGetJson })).toEqual([]);
    const none = vi.fn(async () => geoPayload([]));
    expect(await fetchCommonsPhotosNear(44.1, -72.8, {}, { httpGetJson: none })).toEqual([]);
  });
});

describe("commonsPhotosToCacheResults", () => {
  it("maps to accepted cache items with distance confidence and attribution", () => {
    const items = commonsPhotosToCacheResults(
      [{
        title: "File:Near.jpg", distanceMeters: 40,
        thumbnailUrl: "https://up.wiki/thumb.jpg", imageUrl: "https://up.wiki/Near.jpg",
        descriptionUrl: "https://commons.wikimedia.org/wiki/File:Near.jpg",
        width: 4000, height: 3000, artist: "Ann", license: "CC0",
      }],
      "2026-07-16T00:00:00Z",
    );
    expect(items).toHaveLength(1);
    const it0 = items[0]!;
    expect(it0.validationStatus).toBe("accepted");
    expect(it0.confidence).toBe(75);
    expect(it0.provider).toBe("wikimedia");
    expect(String(it0.attributionText)).toContain("Ann");
    expect(String(it0.attributionText)).toContain("CC0");
  });
});
