import { describe, expect, it } from "vitest";
import {
  buildSafeDisplayTextBlock,
  getDisplayDescriptionFromPostDoc,
  sanitizeHydratedPostDisplayText,
} from "./displayText.js";
import { standardizePostDocForRender } from "../../services/posts/standardize-post-doc-for-render.js";

const WIKIMEDIA_SEARCHABLE =
  "Lonesome Lake Lonesome Lake File:Cirque of the Towers from Lonesome Lake in August 2024.jpg lake swimming kayaking hiking mountain";

function minimalRenderablePost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "wmc_wmvp_ready_1778243152169_40f5ae6e",
    postId: "wmc_wmvp_ready_1778243152169_40f5ae6e",
    title: "Lonesome Lake",
    activities: ["lake", "swimming", "kayaking", "hiking", "mountain"],
    text: {
      title: "Lonesome Lake",
      caption: "",
      description: "",
      content: "",
      searchableText: WIKIMEDIA_SEARCHABLE,
    },
    media: {
      assets: [
        {
          id: "asset-1",
          index: 0,
          type: "image",
          image: {
            displayUrl: "https://cdn.example.com/lonesome-lake.jpg",
            originalUrl: "https://cdn.example.com/lonesome-lake.jpg",
            thumbnailUrl: "https://cdn.example.com/lonesome-lake-thumb.jpg",
            width: 1080,
            height: 1080,
            aspectRatio: 1,
            orientation: "square",
          },
        },
      ],
    },
    ...overrides,
  };
}

describe("displayText helpers", () => {
  it("A. Wikimedia imported post keeps display fields empty and title intact", () => {
    const raw = minimalRenderablePost();
    const safe = buildSafeDisplayTextBlock(raw);
    expect(safe.title).toBe("Lonesome Lake");
    expect(safe.description).toBe("");
    expect(safe.caption).toBe("");
    expect(safe.content).toBe("");
    expect(getDisplayDescriptionFromPostDoc(raw)).toBe("");

    const standardized = standardizePostDocForRender(raw, raw.postId as string);
    expect(standardized.ok).toBe(true);
    if (!standardized.ok) return;
    expect(standardized.doc.title).toBe("Lonesome Lake");
    expect(standardized.doc.text.description).toBe("");
    expect(standardized.doc.text.caption).toBe("");
    expect(standardized.doc.text.content).toBe("");
    expect(standardized.doc.content).toBe("");
    expect(standardized.doc.text.searchableText).toBe("");
    expect(standardized.doc.activities).toEqual(["lake", "swimming", "kayaking", "hiking", "mountain"]);
  });

  it("B. Real user post keeps authored description", () => {
    const raw = minimalRenderablePost({
      text: {
        title: "Sunset spot",
        caption: "",
        description: "Had such an unreal sunset here with my friends",
        content: "",
        searchableText: "sunset lake hiking",
      },
    });
    const safe = buildSafeDisplayTextBlock(raw);
    expect(safe.description).toBe("Had such an unreal sunset here with my friends");
    expect(safe.caption).toBe("");
    expect(safe.content).toBe("");
  });

  it("C. Caption-only user post keeps caption without using searchableText", () => {
    const raw = minimalRenderablePost({
      text: {
        title: "After class",
        caption: "Perfect spot after class",
        description: "",
        content: "",
        searchableText: "after class spot hiking",
      },
    });
    const safe = buildSafeDisplayTextBlock(raw);
    expect(safe.caption).toBe("Perfect spot after class");
    expect(safe.description).toBe("");
    expect(safe.content).toBe("");
    expect(getDisplayDescriptionFromPostDoc(raw)).toBe("Perfect spot after class");
  });

  it("D. Description equals title stays empty when searchableText is the only junk copy", () => {
    const raw = minimalRenderablePost({
      title: "Lonesome Lake",
      text: {
        title: "Lonesome Lake",
        caption: "",
        description: "",
        content: "",
        searchableText: WIKIMEDIA_SEARCHABLE,
      },
    });
    const safe = buildSafeDisplayTextBlock(raw);
    expect(safe.title).toBe("Lonesome Lake");
    expect(safe.description).toBe("");
    expect(safe.content).toBe("");
  });

  it("E. Hydrated response sanitizer blanks only leaking display fields", () => {
    const response = {
      postId: "post-1",
      content: WIKIMEDIA_SEARCHABLE,
      compatibility: { content: WIKIMEDIA_SEARCHABLE },
      text: {
        title: "Lonesome Lake",
        caption: "",
        description: "",
        content: "",
        searchableText: WIKIMEDIA_SEARCHABLE,
      },
    };
    const result = sanitizeHydratedPostDisplayText(response, {
      route: "test.sanitizer",
      postId: "post-1",
    });
    expect(result.strippedFields).toContain("content");
    expect(result.strippedFields).toContain("compatibility.content");
    expect(result.strippedFields).toContain("text.searchableText");
    expect(response.content).toBe("");
    expect(response.compatibility.content).toBe("");
    expect(response.text.searchableText).toBe("");
    expect(response.text.title).toBe("Lonesome Lake");
  });
});
