import type { PlaceImageResult } from "../../types/places.js";

const FORUM_SOURCE_URL_PATTERNS = [
  /\/threads?\//i,
  /\/forum(?:s)?\//i,
  /\/topic\//i,
  /viewtopic\.php/i,
  /showthread\.php/i,
  /\/comments\//i,
  /\/discussion\//i,
  /(?:^|\/)board(?:\/|$)/i,
  /\/groups?\//i,
  /\/community\//i,
];

const FORUM_HOST_PATTERNS = [
  /tacomaworld\.com/i,
  /reddit\.com/i,
  /old\.reddit/i,
  /quora\.com/i,
  /bushcraftusa\.com/i,
  /advrider\.com/i,
  /jeepforum\.com/i,
  /expeditionportal\.com/i,
  /trailvoy\.com/i,
  /ih8mud\.com/i,
  /bobistheoilguy\.com/i,
];

const FORUM_TITLE_PATTERNS = [
  /\|\s*page\s+\d+\s*\|/i,
  /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+\d{1,2}\/\d{1,2}\s+-/i,
  /\bthread\b.*\b(?:page|replies|posts)\b/i,
];

const MIN_PHOTO_EDGE_PX = 240;

function haystack(result: PlaceImageResult): string {
  return `${result.caption} ${result.title ?? ""} ${result.sourceName} ${result.sourceUrl} ${result.imageUrl} ${result.sourceDomain ?? ""}`.toLowerCase();
}

function sourceUrls(result: PlaceImageResult): string {
  return `${result.sourceUrl} ${result.imageUrl}`.toLowerCase();
}

export function isDiscussionOrForumResult(result: PlaceImageResult): boolean {
  const hay = haystack(result);
  const urls = sourceUrls(result);

  if (FORUM_SOURCE_URL_PATTERNS.some((pattern) => pattern.test(urls))) {
    return true;
  }

  if (FORUM_HOST_PATTERNS.some((pattern) => pattern.test(hay))) {
    return true;
  }

  const title = (result.title || result.caption || "").trim();
  if (title && FORUM_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return true;
  }

  const width = result.imageWidth ?? 0;
  const height = result.imageHeight ?? 0;
  if (width > 0 && height > 0 && width < MIN_PHOTO_EDGE_PX && height < MIN_PHOTO_EDGE_PX) {
    return true;
  }

  return false;
}

export function classifyDiscussionOrForumResult(result: PlaceImageResult): {
  isForum: boolean;
  reason?: "forum_or_discussion_page" | "thumbnail_too_small";
} {
  const hay = haystack(result);
  const urls = sourceUrls(result);
  const title = (result.title || result.caption || "").trim();

  if (FORUM_SOURCE_URL_PATTERNS.some((pattern) => pattern.test(urls))) {
    return { isForum: true, reason: "forum_or_discussion_page" };
  }
  if (FORUM_HOST_PATTERNS.some((pattern) => pattern.test(hay))) {
    return { isForum: true, reason: "forum_or_discussion_page" };
  }
  if (title && FORUM_TITLE_PATTERNS.some((pattern) => pattern.test(title))) {
    return { isForum: true, reason: "forum_or_discussion_page" };
  }

  const width = result.imageWidth ?? 0;
  const height = result.imageHeight ?? 0;
  if (width > 0 && height > 0 && width < MIN_PHOTO_EDGE_PX && height < MIN_PHOTO_EDGE_PX) {
    return { isForum: true, reason: "thumbnail_too_small" };
  }

  return { isForum: false };
}
