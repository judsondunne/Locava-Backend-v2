import { describe, expect, it } from "vitest";
import type { PlaceImageResult } from "../../types/places.js";
import { classifyDiscussionOrForumResult } from "./detectDiscussionOrForumResult.js";
import { scorePhotoSearchResultsForParsedQuery } from "./scorePhotoSearchResultsForPlace.js";
import { buildPlaceQuery } from "../places/searchPlaceImages.service.js";

function img(partial: Partial<PlaceImageResult>): PlaceImageResult {
  return {
    id: "x",
    imageUrl: "https://example.com/photo.jpg",
    caption: "",
    sourceName: "example.com",
    sourceUrl: "https://example.com",
    ...partial,
  };
}

describe("detectDiscussionOrForumResult", () => {
  it("flags Tacoma World thread pages", () => {
    const result = classifyDiscussionOrForumResult(
      img({
        title: "Sunday 9/20 - Sucker Pond Trail, Bennington VT | Tacoma World",
        caption: "Sunday 9/20 - Sucker Pond Trail, Bennington VT | Tacoma World",
        sourceUrl: "https://www.tacomaworld.com/threads/sunday-9-20-sucker-pond-trail-bennington-vt.684389/",
        sourceName: "tacomaworld.com",
      }),
    );
    expect(result.isForum).toBe(true);
    expect(result.reason).toBe("forum_or_discussion_page");
  });

  it("flags paginated forum titles", () => {
    const result = classifyDiscussionOrForumResult(
      img({
        title: "Sunday 9/20 - Sucker Pond Trail, Bennington VT | Page 33 | Tacoma World",
        sourceUrl: "https://www.tacomaworld.com/threads/sunday-9-20-sucker-pond-trail-bennington-vt.684389/page-33",
      }),
    );
    expect(result.isForum).toBe(true);
  });

  it("allows normal trail photo pages", () => {
    const result = classifyDiscussionOrForumResult(
      img({
        title: "Sucker Pond trail in Bennington Vermont",
        sourceUrl: "https://www.alltrails.com/trail/us/vermont/sucker-pond",
        sourceName: "alltrails.com",
      }),
    );
    expect(result.isForum).toBe(false);
  });
});

describe("scorePhotoSearchResultsForParsedQuery undiscovered_app", () => {
  it("rejects forum thread hits for Sucker Pond and leaves blank", () => {
    const query = buildPlaceQuery("Sucker Pond, Bennington, Vermont");
    const scored = scorePhotoSearchResultsForParsedQuery(
      query,
      [
        img({
          imageUrl: "https://www.tacomaworld.com/styles/default/xenforo/logo.png",
          title: "Sunday 9/20 - Sucker Pond Trail, Bennington VT | Tacoma World",
          caption: "Sunday 9/20 - Sucker Pond Trail, Bennington VT | Tacoma World",
          sourceUrl: "https://www.tacomaworld.com/threads/sunday-9-20-sucker-pond-trail-bennington-vt.684389/",
          sourceName: "tacomaworld.com",
        }),
        img({
          imageUrl: "https://www.tacomaworld.com/styles/default/xenforo/logo.png",
          title: "Sunday 9/20 - Sucker Pond Trail, Bennington VT | Page 33 | Tacoma World",
          caption: "Sunday 9/20 - Sucker Pond Trail, Bennington VT | Page 33 | Tacoma World",
          sourceUrl: "https://www.tacomaworld.com/threads/sunday-9-20-sucker-pond-trail-bennington-vt.684389/page-33",
          sourceName: "tacomaworld.com",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: false },
    );
    expect(scored.assetsReady).toBe(false);
    expect(scored.acceptedAssets).toHaveLength(0);
    expect(scored.rejectedCount).toBeGreaterThan(0);
    expect(scored.topRejectionReasons.some((r) => r.includes("forum_or_discussion_page"))).toBe(true);
  });

  it("accepts real place photos in undiscovered_app mode", () => {
    const query = buildPlaceQuery("Sucker Pond, Bennington, Vermont");
    const scored = scorePhotoSearchResultsForParsedQuery(
      query,
      [
        img({
          imageUrl: "https://www.alltrails.com/photos/sucker-pond.jpg",
          title: "Sucker Pond Bennington Vermont trail photo",
          caption: "Sucker Pond Bennington Vermont trail photo",
          sourceUrl: "https://www.alltrails.com/trail/us/vermont/sucker-pond",
          sourceName: "alltrails.com",
        }),
        img({
          imageUrl: "https://benningtonbanner.com/sucker-pond.jpg",
          title: "Sucker Pond scenic view Bennington VT",
          caption: "Sucker Pond scenic view Bennington VT",
          sourceUrl: "https://www.benningtonbanner.com/local-news/sucker-pond",
          sourceName: "benningtonbanner.com",
        }),
      ],
      { scoringProfile: "undiscovered_app", strictTitleSourceMatch: false },
    );
    expect(scored.assetsReady).toBe(true);
    expect(scored.acceptedAssets.length).toBeGreaterThan(0);
  });
});
