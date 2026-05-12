import { debugLog } from "../logging/debug-log.js";

export type PostDocLike = Record<string, unknown>;

const DISPLAY_FIELD_PATHS = [
  "description",
  "caption",
  "content",
  "body",
  "subtitle",
  "previewText",
  "detailsText",
  "renderedDescription",
  "displayText",
  "text.description",
  "text.caption",
  "text.content",
  "text.body",
  "text.subtitle",
  "compatibility.description",
  "compatibility.caption",
  "compatibility.content",
  "appPostV2.text.description",
  "appPostV2.text.caption",
  "appPostV2.text.content",
  "appPost.text.description",
  "appPost.text.caption",
  "appPost.text.content",
  "canonicalPost.text.description",
  "canonicalPost.text.caption",
  "canonicalPost.text.content",
  "post.text.description",
  "post.text.caption",
  "post.text.content",
] as const;

const DISPLAY_SOURCE_PATHS = [
  "text.description",
  "description",
  "text.caption",
  "caption",
  "text.content",
  "content",
  "appPostV2.text.description",
  "appPostV2.text.caption",
  "compatibility.description",
  "compatibility.caption",
  "compatibility.content",
] as const;

const GENERATED_DISPLAY_MARKERS = [
  "file:",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  "wikimedia",
  "commons.wikimedia",
  "upload.wikimedia.org",
] as const;

function asRecord(value: unknown): PostDocLike | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as PostDocLike) : null;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeComparable(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function readNestedString(doc: PostDocLike, dotPath: string): string | undefined {
  const segments = dotPath.split(".");
  let current: unknown = doc;
  for (const segment of segments) {
    const record = asRecord(current);
    if (!record || !(segment in record)) return undefined;
    current = record[segment];
  }
  return typeof current === "string" ? current : undefined;
}

function writeNestedString(doc: PostDocLike, dotPath: string, value: string): void {
  const segments = dotPath.split(".");
  let current: PostDocLike = doc;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i]!;
    const next = asRecord(current[segment]);
    if (!next) {
      const created: PostDocLike = {};
      current[segment] = created;
      current = created;
    } else {
      current = next;
    }
  }
  current[segments[segments.length - 1]!] = value;
}

function textBlockFrom(postDoc: PostDocLike | null | undefined): PostDocLike | null {
  if (!postDoc) return null;
  const nested = asRecord(postDoc.text);
  if (nested) return nested;
  const app = asRecord(postDoc.appPostV2);
  const appText = app ? asRecord(app.text) : null;
  if (appText) return appText;
  return null;
}

export function getRawSearchableText(postDoc: PostDocLike | null | undefined): string {
  if (!postDoc) return "";
  const text = textBlockFrom(postDoc);
  const fromText = trimString(text?.searchableText);
  if (fromText) return fromText;
  return trimString(postDoc.searchableText ?? postDoc.searchText);
}

function looksGeneratedDisplayJunk(value: string): boolean {
  const lower = value.toLowerCase();
  return GENERATED_DISPLAY_MARKERS.some((marker) => lower.includes(marker));
}

function isAllowedDisplaySourceValue(postDoc: PostDocLike, value: string): boolean {
  const comparable = normalizeComparable(value);
  if (!comparable) return false;
  for (const path of DISPLAY_SOURCE_PATHS) {
    const candidate = trimString(readNestedString(postDoc, path));
    if (candidate && normalizeComparable(candidate) === comparable) return true;
  }
  return false;
}

export function isUnsafeSearchOnlyText(value: unknown, postDoc: PostDocLike | null | undefined): boolean {
  const trimmed = trimString(value);
  if (!trimmed) return false;
  const searchable = normalizeComparable(getRawSearchableText(postDoc));
  const comparable = normalizeComparable(trimmed);
  if (!searchable) return false;
  if (comparable === searchable) return true;
  if (looksGeneratedDisplayJunk(trimmed) && !isAllowedDisplaySourceValue(postDoc ?? {}, trimmed)) {
    return comparable === searchable;
  }
  return false;
}

export function sanitizeDisplayFieldValue(value: unknown, postDoc: PostDocLike | null | undefined): string {
  const trimmed = trimString(value);
  if (!trimmed) return "";
  if (isUnsafeSearchOnlyText(trimmed, postDoc)) return "";
  if (looksGeneratedDisplayJunk(trimmed) && !isAllowedDisplaySourceValue(postDoc ?? {}, trimmed)) {
    const searchable = normalizeComparable(getRawSearchableText(postDoc));
    if (searchable && normalizeComparable(trimmed) === searchable) return "";
  }
  return trimmed;
}

export function getDisplayDescriptionFromPostDoc(postDoc: PostDocLike | null | undefined): string {
  if (!postDoc) return "";
  for (const path of DISPLAY_SOURCE_PATHS) {
    const candidate = sanitizeDisplayFieldValue(readNestedString(postDoc, path), postDoc);
    if (candidate) return candidate;
  }
  return "";
}

export type SafeDisplayTextBlock = {
  title: string;
  caption: string;
  description: string;
  content: string;
};

export function buildSafeDisplayTextBlock(postDoc: PostDocLike | null | undefined): SafeDisplayTextBlock {
  if (!postDoc) {
    return { title: "", caption: "", description: "", content: "" };
  }
  const text = textBlockFrom(postDoc);
  return {
    title: trimString(text?.title) || trimString(postDoc.title),
    caption: sanitizeDisplayFieldValue(text?.caption ?? postDoc.caption, postDoc),
    description: sanitizeDisplayFieldValue(text?.description ?? postDoc.description, postDoc),
    content: sanitizeDisplayFieldValue(text?.content ?? postDoc.content, postDoc),
  };
}

export type SanitizeHydratedPostDisplayTextContext = {
  route?: string;
  source?: string;
  postId?: string;
  omitSearchableTextFromClient?: boolean;
};

export type SanitizeHydratedPostDisplayTextResult = {
  strippedFields: string[];
};

function resolvePostId(response: PostDocLike, context: SanitizeHydratedPostDisplayTextContext): string {
  return trimString(context.postId) || trimString(response.postId) || trimString(response.id) || "unknown";
}

export function sanitizeHydratedPostDisplayText(
  response: PostDocLike,
  context: SanitizeHydratedPostDisplayTextContext = {},
): SanitizeHydratedPostDisplayTextResult {
  const strippedFields: string[] = [];
  const searchable = getRawSearchableText(response);
  const postId = resolvePostId(response, context);

  for (const path of DISPLAY_FIELD_PATHS) {
    const current = readNestedString(response, path);
    if (current === undefined) continue;
    const sanitized = sanitizeDisplayFieldValue(current, response);
    if (sanitized !== trimString(current)) {
      writeNestedString(response, path, sanitized);
      strippedFields.push(path);
      debugLog("post", "POST_DISPLAY_TEXT_STRIPPED_SEARCHABLE_TEXT", {
        route: context.route ?? context.source ?? "unknown",
        source: context.source ?? context.route ?? "unknown",
        postId,
        fieldName: path,
        searchableText: searchable,
        strippedValue: trimString(current),
      });
    }
  }

  if (context.omitSearchableTextFromClient !== false) {
    for (const path of ["text.searchableText", "searchableText", "searchText", "appPostV2.text.searchableText", "appPost.text.searchableText", "canonicalPost.text.searchableText", "post.text.searchableText"] as const) {
      const current = readNestedString(response, path);
      if (current === undefined) continue;
      if (trimString(current)) {
        writeNestedString(response, path, "");
        strippedFields.push(path);
      }
    }
  }

  return { strippedFields };
}
