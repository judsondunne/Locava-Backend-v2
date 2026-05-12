/** Heuristics to keep outdoor / landscape-style Commons files and drop posters, signs, maps, scans, etc. */

export type RejectedCommonsFile = {
  pageId: number;
  title: string;
  pageUrl: string;
  thumbUrl: string | null;
  reasons: string[];
};

/** Aligned with Commons web thumbnails / older uploads; still blocks tiny phone shots. */
const MIN_SHORT_EDGE_PX = 680;
const MIN_MEGAPIXELS = 0.68;
const MIN_FILE_BYTES = 55_000;
/** Reject landscape panos / ultra-wide strips (long ÷ short). ~16:9 = 1.78; true panos are usually ≥2.4. */
const MAX_LANDSCAPE_ASPECT = 2.35;
/** Ultra-tall portrait strips (UI / signage). */
const MIN_ASPECT_FOR_STRICT = 1.02;

function stripHtml(raw: string): string {
  return String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fileStem(title: string): string {
  return String(title || "")
    .replace(/^File:/i, "")
    .trim();
}

const TITLE_HINTS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /poster|flyer|brochure|leaflet|booklet|dvd|blu-?ray|album\s*cover|cereal|packaging|merchandise|postcard\s*back/i,
    reason:
      "Name suggests a poster, flyer, print ad, packaging, DVD/Blu-ray art, or merchandise — not a straight outdoor photograph of the place.",
  },
  {
    re: /road[_\s-]?sign|street[_\s-]?sign|traffic[_\s-]?sign|signpost|bill\s*board|billboard|waymarker|information\s*board|interpretive\s*panel/i,
    reason: "Name suggests a sign, billboard, or information panel rather than a scenic photo.",
  },
  {
    re: /\bmap\b|topographic|diagram|chart(?![a-z])|atlas\b|floorplan|floor[_\s-]?plan|cross[_\s-]?section|plat\b|survey\b/i,
    reason: "Name suggests a map, diagram, chart, or plan — not a photo of the landscape.",
  },
  {
    re: /logo|icon\b|favicon|sprite|screenshot|screen[_\s-]?grab|ui[_\s-]|user\s*interface|button\b|qr[_\s-]?code|barcode/i,
    reason: "Name suggests logos, icons, screenshots, or UI captures.",
  },
  {
    re: /\bstamp\b|\bcurrency\b|\bcoin\b|\bticket\b|\bpatch\b|\bbadge\b|\blabel\b|\bsticker\b|license\s*plate/i,
    reason: "Name suggests stamps, money, tickets, badges, or labels.",
  },
  {
    re: /scanned|scan\b|document|newspaper|manuscript|typescript|book\s*page|encyclopedia|extracted\s*text/i,
    reason: "Name suggests a scanned document or printed page.",
  },
  {
    re: /\b(facade|frontage|bungalow|cottage|mansion|duplex|townhouse|brownstone|victorian\s+home|colonial\s+home|apartment|condo|townhome|bedroom|kitchen|dining\s+room|living\s+room|bathroom)\b/i,
    reason:
      "Name looks like a house, apartment, or interior room — not an open landscape / summit scene.",
  },
  {
    re: /\b(panorama|panoramic|photo\s*sphere|equirectangular|little\s*planet|360\s*°|360\s*deg|cyclorama)\b/i,
    reason: "Name suggests a panorama / 360° / spherical image — excluded from this feed.",
  },
];

/** Generic “Something house.jpg” naming (common for neighborhood architecture uploads). */
const HOUSE_FILENAME_LIKE = /^[a-z0-9][a-z0-9\s,'._-]{0,48}\bhouse\b\.(jpe?g|png|webp)$/i;

const HAYSTACK_HINTS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\bposters?\b|\broadside\b|\bplaybill\b/i,
    reason: "Categories or description mention posters or similar print ephemera.",
  },
  {
    re: /\bdiagrams?\b|\bcharts?\b|\bgraphs?\b|\bmaps?\b|\bcartography\b|\batlas\b|\bfloor[_\s-]?plans?\b/i,
    reason: "Categories or description look like diagrams, charts, or maps.",
  },
  {
    re: /\bscreenshots?\b|\bsoftware\b|\buser\s*interfaces?\b|\blogos?\b|\bicons?\b/i,
    reason: "Categories or description reference screenshots, software, logos, or icons.",
  },
  {
    re: /\bscanned\s+documents?\b|\bmanuscripts?\b|\btypescript\b|\bnewspapers?\b/i,
    reason: "Categories or description reference scanned documents or newspapers.",
  },
  {
    re: /\bblack[\s_-]*and[\s_-]*white\b|\bmonochrome\b|\bgrayscale\b|\bgreyscale\b|\bsepia\b|\bdesaturated\b/i,
    reason: "Marked or described as black & white, monochrome, grayscale, or sepia — color-only feed.",
  },
  {
    re: /\b(houses in|house in|residential buildings|historic houses|apartment buildings|condominiums|single-family|multi-family|rowhouses|bungalows in|dwellings in|neighborhood of houses|street of houses)\b/i,
    reason: "Categories or description read like residential / neighborhood architecture, not a scenic landmark photo.",
  },
  {
    re: /\b(360° panoramas|360\s*deg panoramas|spherical panoramas|equirectangular|full\s*360|photosynth|cyclorama|panoramics in)\b/i,
    reason: "Categories or description indicate a panorama / 360° / spherical image.",
  },
];

function dedupeReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of reasons) {
    const k = r.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export type CommonsQualityInput = {
  title: string;
  mime: string;
  width: number;
  height: number;
  byteSize: number;
  /** Pipe-separated from extmetadata.Categories plus ObjectName and stripped description. */
  textHaystack: string;
};

export function evaluateCommonsPhotoQuality(input: CommonsQualityInput): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const mime = String(input.mime || "").toLowerCase();
  if (!mime.startsWith("image/") || mime === "image/svg+xml") {
    reasons.push("Not a usable color raster photo (SVG, non-image, or missing MIME).");
    return { ok: false, reasons };
  }
  if (mime === "image/gif") {
    reasons.push(
      "GIF format — on Commons often diagrams, UI, or animations; this feed keeps JPEG/PNG/WebP-style photos only.",
    );
    return { ok: false, reasons: dedupeReasons(reasons) };
  }

  const stem = fileStem(input.title);

  const w = Math.max(0, Math.floor(input.width));
  const h = Math.max(0, Math.floor(input.height));
  const shortEdge = w > 0 && h > 0 ? Math.min(w, h) : 0;
  const longEdge = w > 0 && h > 0 ? Math.max(w, h) : 0;
  const mp = w > 0 && h > 0 ? (w * h) / 1_000_000 : 0;
  const aspect = shortEdge > 0 ? longEdge / shortEdge : 0;

  if (shortEdge < MIN_SHORT_EDGE_PX) {
    reasons.push(
      `Resolution too low for a sharp print-style photo (short edge ${shortEdge}px; need ≥${MIN_SHORT_EDGE_PX}px).`,
    );
  }
  if (mp < MIN_MEGAPIXELS) {
    reasons.push(`Too few megapixels (${mp.toFixed(2)} MP; need ≥${MIN_MEGAPIXELS} MP).`);
  }
  if (input.byteSize < MIN_FILE_BYTES) {
    reasons.push(
      `File is very small (${Math.round(input.byteSize / 1024)} KB; need ≥${Math.round(MIN_FILE_BYTES / 1024)} KB) — often thumbnails, UI grabs, or heavy compression.`,
    );
  }
  if (aspect > MAX_LANDSCAPE_ASPECT) {
    reasons.push(
      `Panorama-style aspect ratio (${aspect.toFixed(2)}:1, max ${MAX_LANDSCAPE_ASPECT}:1) — ultra-wide frames are excluded.`,
    );
  }
  if (aspect > 0 && aspect < MIN_ASPECT_FOR_STRICT && shortEdge < 900) {
    reasons.push("Very tall/narrow crop with low resolution — often UI or signage slices.");
  }

  if (HOUSE_FILENAME_LIKE.test(stem)) {
    reasons.push(
      "Filename looks like a single-family or neighborhood house upload (e.g. “Lastname house.jpg”) — excluded from scenic picks.",
    );
  }
  for (const { re, reason } of TITLE_HINTS) {
    if (re.test(stem)) reasons.push(reason);
  }

  const hay = String(input.textHaystack || "").slice(0, 12_000);
  for (const { re, reason } of HAYSTACK_HINTS) {
    if (re.test(hay)) reasons.push(reason);
  }

  const out = dedupeReasons(reasons);
  return { ok: out.length === 0, reasons: out };
}

export function buildCommonsTextHaystack(input: {
  extCategoriesPipe?: string | null;
  objectName?: string | null;
  imageDescriptionHtml?: string | null;
}): string {
  const parts = [
    String(input.extCategoriesPipe || ""),
    String(input.objectName || ""),
    stripHtml(String(input.imageDescriptionHtml || "")),
  ];
  return parts.join(" | ").toLowerCase();
}
