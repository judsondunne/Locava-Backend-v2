export type ExistingMediaKind =
  | "direct_image"
  | "commons_file"
  | "commons_category"
  | "mapillary"
  | "wikipedia"
  | "wikidata"
  | "website"
  | "generic_media_url"
  | "unknown_media_tag";

export type ExistingMediaRef = {
  id: string;
  sourceKey: string;
  inventoryId?: string;
  inventoryName?: string;
  itemKind?: "spot" | "route" | "raw";
  tagKey: string;
  rawValue: string;
  mediaKind: ExistingMediaKind;
  canPreview: boolean;
  previewUrl?: string;
  sourceUrl?: string;
  displayUrl?: string;
  label: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
  requiresLaterResolution: boolean;
};

export type MediaRefContext = {
  sourceKey?: string;
  inventoryId?: string;
  inventoryName?: string;
  itemKind?: "spot" | "route" | "raw";
};

const EXACT_MEDIA_KEYS = new Set([
  "image",
  "image:0",
  "image:1",
  "image:2",
  "image:url",
  "image:source",
  "image:license",
  "wikimedia_commons",
  "wikidata",
  "wikipedia",
  "mapillary",
  "mapillary:image",
  "mapillary:map_feature",
  "website",
  "contact:website",
  "url",
  "source",
  "source:image",
  "source_ref",
  "commons",
  "wikimedia",
  "photo",
  "photos",
]);

const MEDIA_KEY_SUBSTRINGS = ["image", "photo", "media", "commons", "wikimedia", "mapillary", "wikipedia", "wikidata"];

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)(\?|$|#)/i;

function stableId(sourceKey: string, tagKey: string, rawValue: string, index: number): string {
  return `${sourceKey}|${tagKey}|${index}|${rawValue.slice(0, 80)}`;
}

function tagValueToString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isDirectImageUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  try {
    const u = new URL(value);
    const path = u.pathname.toLowerCase();
    return IMAGE_EXT_RE.test(path) || IMAGE_EXT_RE.test(value);
  } catch {
    return IMAGE_EXT_RE.test(value);
  }
}

function encodeWikiTitle(title: string): string {
  return title.trim().replace(/ /g, "_");
}

function parseCommonsFileTitle(value: string): string | null {
  let v = value.trim();
  if (!v) return null;
  v = v.replace(/^commons:/i, "");
  if (/^https?:\/\//i.test(v)) {
    const m = v.match(/\/wiki\/File:(.+)$/i);
    if (m?.[1]) return decodeURIComponent(m[1].replace(/_/g, " ")).replace(/ /g, "_");
    return null;
  }
  if (/^file:/i.test(v)) return v.replace(/^file:/i, "File:").startsWith("File:") ? v.replace(/^file:/i, "File:") : `File:${v.replace(/^file:/i, "")}`;
  if (/^category:/i.test(v)) return null;
  if (!v.startsWith("File:") && !v.includes("/")) return `File:${v}`;
  if (v.startsWith("File:")) return v;
  return null;
}

function parseCommonsCategory(value: string): string | null {
  let v = value.trim().replace(/^commons:/i, "");
  if (/^https?:\/\//i.test(v)) {
    const m = v.match(/\/wiki\/Category:(.+)$/i);
    if (m?.[1]) return decodeURIComponent(m[1].replace(/_/g, " "));
    return null;
  }
  if (/^category:/i.test(v)) return v.replace(/^category:/i, "").trim();
  if (/^Category:/i.test(v)) return v.replace(/^Category:/i, "").trim();
  return null;
}

function splitMultiValues(value: string): string[] {
  if (value.includes(";")) return value.split(";").map((p) => p.trim()).filter(Boolean);
  if (value.includes("|")) return value.split("|").map((p) => p.trim()).filter(Boolean);
  if (value.includes(",")) return value.split(",").map((p) => p.trim()).filter(Boolean);
  return [value.trim()].filter(Boolean);
}

function commonsFileRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef | null {
  const fileTitle = parseCommonsFileTitle(value);
  if (!fileTitle) return null;
  const normalized = fileTitle.startsWith("File:") ? fileTitle : `File:${fileTitle}`;
  const wikiPath = encodeWikiTitle(normalized.replace(/^File:/, ""));
  const sourceUrl = `https://commons.wikimedia.org/wiki/File:${wikiPath}`;
  const filePathTitle = normalized.replace(/^File:/, "");
  const previewUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filePathTitle)}?width=800`;
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: "commons_file",
    canPreview: true,
    previewUrl,
    sourceUrl,
    displayUrl: sourceUrl,
    label: normalized,
    confidence: "high",
    notes: [],
    requiresLaterResolution: false,
  };
}

function commonsCategoryRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef | null {
  const cat = parseCommonsCategory(value);
  if (!cat) return null;
  const sourceUrl = `https://commons.wikimedia.org/wiki/Category:${encodeWikiTitle(cat)}`;
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: "commons_category",
    canPreview: false,
    sourceUrl,
    displayUrl: sourceUrl,
    label: `Category:${cat}`,
    confidence: "medium",
    notes: ["Commons category requires later API/search resolution"],
    requiresLaterResolution: true,
  };
}

function wikidataRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef {
  const q = value.trim().match(/Q\d+/i)?.[0]?.toUpperCase() ?? value.trim();
  const sourceUrl = `https://www.wikidata.org/wiki/${q}`;
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: "wikidata",
    canPreview: false,
    sourceUrl,
    displayUrl: sourceUrl,
    label: q,
    confidence: "medium",
    notes: ["Could resolve P18 image later, but not in this task"],
    requiresLaterResolution: true,
  };
}

function wikipediaRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef {
  const raw = value.trim();
  let lang = "en";
  let title = raw;
  const colon = raw.indexOf(":");
  if (colon > 0 && colon < 6) {
    lang = raw.slice(0, colon);
    title = raw.slice(colon + 1);
  }
  const sourceUrl = `https://${lang}.wikipedia.org/wiki/${encodeWikiTitle(title)}`;
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: "wikipedia",
    canPreview: false,
    sourceUrl,
    displayUrl: sourceUrl,
    label: title,
    confidence: "medium",
    notes: ["Could resolve lead image later, but not in this task"],
    requiresLaterResolution: true,
  };
}

function mapillaryRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef {
  const raw = value.trim();
  let sourceUrl = raw;
  if (!isHttpUrl(raw)) {
    sourceUrl = `https://www.mapillary.com/app/?pKey=${encodeURIComponent(raw)}`;
  }
  const direct = isDirectImageUrl(raw);
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: "mapillary",
    canPreview: direct,
    previewUrl: direct ? raw : undefined,
    sourceUrl,
    displayUrl: sourceUrl,
    label: "Mapillary",
    confidence: direct ? "high" : "medium",
    notes: ["Mapillary display/storage rules require review; link only for now"],
    requiresLaterResolution: !direct,
  };
}

function websiteRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef {
  const direct = isDirectImageUrl(value);
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: direct ? "direct_image" : "website",
    canPreview: direct,
    previewUrl: direct ? value : undefined,
    sourceUrl: value,
    displayUrl: value,
    label: direct ? "Direct image URL" : "Website",
    confidence: direct ? "high" : "low",
    notes: direct ? [] : ["Website is not a licensed image source by default"],
    requiresLaterResolution: !direct,
  };
}

function directImageRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef {
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: "direct_image",
    canPreview: true,
    previewUrl: value,
    sourceUrl: value,
    displayUrl: value,
    label: "Direct image",
    confidence: "high",
    notes: [],
    requiresLaterResolution: false,
  };
}

function genericUrlRef(value: string, ctx: MediaRefContext, tagKey: string, index: number): ExistingMediaRef {
  const lower = value.toLowerCase();
  let mediaKind: ExistingMediaKind = "generic_media_url";
  if (lower.includes("commons.wikimedia.org") || lower.includes("upload.wikimedia.org")) mediaKind = "commons_file";
  else if (lower.includes("wikidata.org")) mediaKind = "wikidata";
  else if (lower.includes("wikipedia.org")) mediaKind = "wikipedia";
  else if (lower.includes("mapillary.com")) mediaKind = "mapillary";

  const direct = isDirectImageUrl(value);
  return {
    id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
    sourceKey: ctx.sourceKey ?? "raw",
    inventoryId: ctx.inventoryId,
    inventoryName: ctx.inventoryName,
    itemKind: ctx.itemKind,
    tagKey,
    rawValue: value,
    mediaKind: direct ? "direct_image" : mediaKind,
    canPreview: direct,
    previewUrl: direct ? value : undefined,
    sourceUrl: value,
    displayUrl: value,
    label: tagKey,
    confidence: direct ? "high" : "low",
    notes: [],
    requiresLaterResolution: !direct,
  };
}

function refsFromTagValue(tagKey: string, rawValue: string, ctx: MediaRefContext): ExistingMediaRef[] {
  const key = tagKey.toLowerCase();
  const parts = key === "wikimedia_commons" ? splitMultiValues(rawValue) : [rawValue];
  const out: ExistingMediaRef[] = [];

  parts.forEach((part, partIndex) => {
    const value = part.trim();
    if (!value) return;
    const index = partIndex;

    if (key === "wikimedia_commons" || key === "commons" || key === "wikimedia") {
      const cat = commonsCategoryRef(value, ctx, tagKey, index);
      if (cat) {
        out.push(cat);
        return;
      }
      const file = commonsFileRef(value, ctx, tagKey, index);
      if (file) {
        out.push(file);
        return;
      }
    }

    if (isDirectImageUrl(value)) {
      out.push(directImageRef(value, ctx, tagKey, index));
      return;
    }

    if (key === "wikidata" || /^Q\d+$/i.test(value)) {
      out.push(wikidataRef(value, ctx, tagKey, index));
      return;
    }

    if (key === "wikipedia") {
      out.push(wikipediaRef(value, ctx, tagKey, index));
      return;
    }

    if (key.startsWith("mapillary") || value.toLowerCase().includes("mapillary")) {
      out.push(mapillaryRef(value, ctx, tagKey, index));
      return;
    }

    if (key === "website" || key === "contact:website" || key === "url") {
      out.push(websiteRef(value, ctx, tagKey, index));
      return;
    }

    if (key.startsWith("image") || key === "photo" || key === "photos") {
      if (isHttpUrl(value)) {
        out.push(isDirectImageUrl(value) ? directImageRef(value, ctx, tagKey, index) : genericUrlRef(value, ctx, tagKey, index));
      } else {
        const file = commonsFileRef(value, ctx, tagKey, index);
        if (file) out.push(file);
        else
          out.push({
            id: stableId(ctx.sourceKey ?? "raw", tagKey, value, index),
            sourceKey: ctx.sourceKey ?? "raw",
            inventoryId: ctx.inventoryId,
            inventoryName: ctx.inventoryName,
            itemKind: ctx.itemKind,
            tagKey,
            rawValue: value,
            mediaKind: "unknown_media_tag",
            canPreview: false,
            label: value,
            confidence: "low",
            notes: ["Non-URL image tag value"],
            requiresLaterResolution: true,
          });
      }
      return;
    }

    if (isHttpUrl(value)) {
      out.push(genericUrlRef(value, ctx, tagKey, index));
      return;
    }

    const lower = value.toLowerCase();
    if (
      lower.includes("commons.wikimedia.org") ||
      lower.includes("wikidata.org") ||
      lower.includes("wikipedia.org") ||
      lower.includes("mapillary.com") ||
      IMAGE_EXT_RE.test(lower)
    ) {
      out.push(genericUrlRef(value, ctx, tagKey, index));
    }
  });

  return out;
}

function isMediaRelevantKey(tagKey: string): boolean {
  const k = tagKey.toLowerCase();
  if (EXACT_MEDIA_KEYS.has(k)) return true;
  return MEDIA_KEY_SUBSTRINGS.some((s) => k.includes(s));
}

function valueHintsMedia(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    isHttpUrl(value) ||
    lower.includes("commons.wikimedia.org") ||
    lower.includes("upload.wikimedia.org") ||
    lower.includes("wikidata.org") ||
    lower.includes("wikipedia.org") ||
    lower.includes("mapillary.com") ||
    IMAGE_EXT_RE.test(lower) ||
    /^Q\d+$/i.test(value.trim()) ||
    /^file:/i.test(value) ||
    /^category:/i.test(value)
  );
}

export function extractExistingMediaRefsFromTags(
  tags: Record<string, unknown>,
  context: MediaRefContext = {}
): ExistingMediaRef[] {
  const out: ExistingMediaRef[] = [];
  const seen = new Set<string>();

  for (const [tagKey, raw] of Object.entries(tags)) {
    const value = tagValueToString(raw);
    if (!value) continue;
    if (!isMediaRelevantKey(tagKey) && !valueHintsMedia(value)) continue;

    for (const ref of refsFromTagValue(tagKey, value, context)) {
      const dedupe = `${ref.tagKey}|${ref.rawValue}|${ref.mediaKind}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(ref);
    }
  }

  return out;
}

export type InventoryItemLike = {
  id?: string;
  sourceKey?: string;
  name?: string;
  displayName?: string;
  kind?: string;
  tags?: Record<string, unknown>;
};

export function extractExistingMediaRefsFromInventoryItem(item: InventoryItemLike): ExistingMediaRef[] {
  const tags = item.tags ?? {};
  const ctx: MediaRefContext = {
    sourceKey: item.sourceKey,
    inventoryId: item.id,
    inventoryName: item.displayName ?? item.name,
    itemKind: item.kind?.includes("route") ? "route" : item.kind?.includes("spot") ? "spot" : "raw",
  };
  return extractExistingMediaRefsFromTags(tags, ctx);
}

export type MediaSummaryFields = {
  existingMediaRefs: ExistingMediaRef[];
  existingMediaRefCount: number;
  previewableMediaCount: number;
  commonsFileCount: number;
  commonsCategoryCount: number;
  wikidataMediaClue: boolean;
  wikipediaMediaClue: boolean;
  mapillaryMediaClue: boolean;
  websiteMediaClue: boolean;
};

export function summarizeExistingMediaRefs(refs: ExistingMediaRef[]): MediaSummaryFields {
  return {
    existingMediaRefs: refs,
    existingMediaRefCount: refs.length,
    previewableMediaCount: refs.filter((r) => r.canPreview).length,
    commonsFileCount: refs.filter((r) => r.mediaKind === "commons_file").length,
    commonsCategoryCount: refs.filter((r) => r.mediaKind === "commons_category").length,
    wikidataMediaClue: refs.some((r) => r.mediaKind === "wikidata"),
    wikipediaMediaClue: refs.some((r) => r.mediaKind === "wikipedia"),
    mapillaryMediaClue: refs.some((r) => r.mediaKind === "mapillary"),
    websiteMediaClue: refs.some((r) => r.mediaKind === "website"),
  };
}

export function attachExistingMediaFields<T extends InventoryItemLike>(item: T): T & MediaSummaryFields {
  const refs = extractExistingMediaRefsFromInventoryItem(item);
  return { ...item, ...summarizeExistingMediaRefs(refs) };
}
