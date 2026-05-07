/**
 * Letterbox hints on post docs are often only on canonical `appPostV2.media.assets[].presentation.letterboxGradient`
 * while root `letterboxGradientTop` is unset. Feed cards + compact detail batch must flatten those for native slot-0 paint.
 */

type LetterboxHintsResult = {
  letterboxGradientTop: string | null | undefined;
  letterboxGradientBottom: string | null | undefined;
  letterboxGradients: Array<{ top: string; bottom: string }> | null | undefined;
};

function gradientPairFromUnknown(g: unknown): { top?: string; bottom?: string } {
  if (!g || typeof g !== "object") return {};
  const gr = g as Record<string, unknown>;
  const t = typeof gr.top === "string" ? gr.top.trim() : "";
  const b = typeof gr.bottom === "string" ? gr.bottom.trim() : "";
  return {
    ...(t ? { top: t } : {}),
    ...(b ? { bottom: b } : {}),
  };
}

/** Shared: Firestore `media` block (locava.post master or locava.appPost) with cover + assets[].presentation. */
function extractLetterboxFromMediaRecord(media: Record<string, unknown>): {
  top?: string;
  bottom?: string;
  perAsset: Array<{ top: string; bottom: string }>;
} {
  const perAsset: Array<{ top: string; bottom: string }> = [];
  let firstTop: string | undefined;
  let firstBottom: string | undefined;
  let coverTop: string | undefined;
  let coverBottom: string | undefined;

  const cover = media.cover as Record<string, unknown> | undefined;
  const coverPair = gradientPairFromUnknown(cover?.gradient);
  if (coverPair.top) coverTop = coverPair.top;
  if (coverPair.bottom) coverBottom = coverPair.bottom;

  const assets = Array.isArray(media.assets) ? media.assets : [];
  for (const raw of assets) {
    if (!raw || typeof raw !== "object") continue;
    const pres = (raw as Record<string, unknown>).presentation as Record<string, unknown> | undefined;
    const pair = gradientPairFromUnknown(pres?.letterboxGradient);
    if (pair.top || pair.bottom) {
      perAsset.push({
        top: pair.top ?? pair.bottom ?? "",
        bottom: pair.bottom ?? pair.top ?? "",
      });
    }
  }

  const first = assets[0] as Record<string, unknown> | undefined;
  const firstPres = first?.presentation as Record<string, unknown> | undefined;
  const firstPair = gradientPairFromUnknown(firstPres?.letterboxGradient);
  if (firstPair.top) firstTop = firstPair.top;
  if (firstPair.bottom) firstBottom = firstPair.bottom;

  // Slot-0 may be a broken/empty row while a later canonical asset carries the real gradient.
  const top = firstTop ?? coverTop ?? perAsset[0]?.top;
  const bottom = firstBottom ?? coverBottom ?? perAsset[0]?.bottom;

  return { top, bottom, perAsset };
}

function letterboxFromNestedCanonicalAppPost(data: Record<string, unknown>): {
  top?: string;
  bottom?: string;
  perAsset: Array<{ top: string; bottom: string }>;
} {
  for (const key of ["appPostV2", "appPost"] as const) {
    const canonical = data[key];
    if (!canonical || typeof canonical !== "object") continue;
    const media = (canonical as Record<string, unknown>).media as Record<string, unknown> | undefined;
    if (!media || typeof media !== "object") continue;
    const extracted = extractLetterboxFromMediaRecord(media);
    if (extracted.perAsset.length > 0 || extracted.top || extracted.bottom) {
      return extracted;
    }
  }
  return { perAsset: [] };
}

function letterboxFromRootMediaObject(data: Record<string, unknown>): {
  top?: string;
  bottom?: string;
  perAsset: Array<{ top: string; bottom: string }>;
} {
  const media = data.media as Record<string, unknown> | undefined;
  if (!media || typeof media !== "object") return { perAsset: [] };
  return extractLetterboxFromMediaRecord(media);
}

/** Top-level legacy `assets[]` (not only appPost) sometimes carries `presentation.letterboxGradient`. */
function letterboxFromRootLegacyAssetsArray(data: Record<string, unknown>): {
  top?: string;
  bottom?: string;
  perAsset: Array<{ top: string; bottom: string }>;
} {
  const assets = data.assets;
  if (!Array.isArray(assets)) return { perAsset: [] };
  const perAsset: Array<{ top: string; bottom: string }> = [];
  let firstTop: string | undefined;
  let firstBottom: string | undefined;
  for (let i = 0; i < assets.length; i += 1) {
    const raw = assets[i];
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const pres = row.presentation as Record<string, unknown> | undefined;
    const pair =
      gradientPairFromUnknown(pres?.letterboxGradient) ?? gradientPairFromUnknown(row.letterboxGradient);
    if (pair.top || pair.bottom) {
      perAsset.push({
        top: pair.top ?? pair.bottom ?? "",
        bottom: pair.bottom ?? pair.top ?? "",
      });
    }
    if (i === 0) {
      if (pair.top) firstTop = pair.top;
      if (pair.bottom) firstBottom = pair.bottom;
    }
  }
  const top = firstTop ?? perAsset[0]?.top;
  const bottom = firstBottom ?? perAsset[0]?.bottom;
  return { top, bottom, perAsset };
}

function longerPerAssetList(
  a: Array<{ top: string; bottom: string }>,
  b: Array<{ top: string; bottom: string }>,
): Array<{ top: string; bottom: string }> {
  return a.length >= b.length ? a : b;
}

function mergeLetterboxExtractions(
  parts: Array<{ top?: string; bottom?: string; perAsset: Array<{ top: string; bottom: string }> }>,
): { top?: string; bottom?: string; perAsset: Array<{ top: string; bottom: string }> } {
  let top: string | undefined;
  let bottom: string | undefined;
  let perAsset: Array<{ top: string; bottom: string }> = [];
  for (const p of parts) {
    if (!top && p.top) top = p.top;
    if (!bottom && p.bottom) bottom = p.bottom;
    perAsset = longerPerAssetList(perAsset, p.perAsset);
  }
  if (!top && perAsset[0]?.top) top = perAsset[0].top;
  if (!bottom && perAsset[0]?.bottom) bottom = perAsset[0].bottom;
  return { top, bottom, perAsset };
}

export function normalizeLetterboxHintsFromFirestorePost(data: Record<string, unknown>): LetterboxHintsResult {
  const legacy = data.legacy as
    | {
        letterboxGradientTop?: unknown;
        letterboxGradientBottom?: unknown;
        letterboxGradients?: unknown;
        letterbox_gradient_top?: unknown;
        letterbox_gradient_bottom?: unknown;
      }
    | undefined;
  const topRaw =
    typeof data.letterboxGradientTop === "string"
      ? data.letterboxGradientTop
      : typeof data.letterbox_gradient_top === "string"
        ? data.letterbox_gradient_top
        : typeof legacy?.letterboxGradientTop === "string"
          ? (legacy.letterboxGradientTop as string)
          : typeof legacy?.letterbox_gradient_top === "string"
            ? (legacy.letterbox_gradient_top as string)
            : null;
  const bottomRaw =
    typeof data.letterboxGradientBottom === "string"
      ? data.letterboxGradientBottom
      : typeof data.letterbox_gradient_bottom === "string"
        ? data.letterbox_gradient_bottom
        : typeof legacy?.letterboxGradientBottom === "string"
          ? (legacy.letterboxGradientBottom as string)
          : typeof legacy?.letterbox_gradient_bottom === "string"
            ? (legacy.letterbox_gradient_bottom as string)
            : null;
  const top = topRaw?.trim() ? topRaw.trim() : null;
  const bottom = bottomRaw?.trim() ? bottomRaw.trim() : null;

  const gradientsRaw = Array.isArray(data.letterboxGradients)
    ? data.letterboxGradients
    : Array.isArray(legacy?.letterboxGradients)
      ? (legacy!.letterboxGradients as unknown[])
      : null;

  let letterboxGradients: Array<{ top: string; bottom: string }> | null | undefined;
  if (Array.isArray(gradientsRaw)) {
    const out: Array<{ top: string; bottom: string }> = [];
    for (const entry of gradientsRaw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { top?: unknown; bottom?: unknown };
      if (typeof e.top !== "string" || typeof e.bottom !== "string") continue;
      const t = e.top.trim();
      const b = e.bottom.trim();
      if (!t || !b) continue;
      out.push({ top: t, bottom: b });
    }
    if (out.length > 0) letterboxGradients = out;
  }

  const nested = mergeLetterboxExtractions([
    letterboxFromNestedCanonicalAppPost(data),
    letterboxFromRootMediaObject(data),
    letterboxFromRootLegacyAssetsArray(data),
  ]);
  const mergedTop = top ?? nested.top ?? undefined;
  const mergedBottom = bottom ?? nested.bottom ?? undefined;
  if ((!letterboxGradients || letterboxGradients.length === 0) && nested.perAsset.length > 0) {
    letterboxGradients = nested.perAsset;
  }

  return {
    letterboxGradientTop: mergedTop ?? undefined,
    letterboxGradientBottom: mergedBottom ?? undefined,
    letterboxGradients,
  };
}
