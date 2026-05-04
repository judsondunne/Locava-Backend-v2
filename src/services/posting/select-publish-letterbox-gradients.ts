/**
 * Letterbox gradient selection for native finalize — avoids placeholder defaults overwriting client/staging colors.
 */

export type LetterboxGradientPair = { top: string; bottom: string };

export type AssetPresentationPublish = {
  letterboxGradient?: LetterboxGradientPair;
  carouselFitWidth?: boolean;
  resizeMode?: "contain" | "cover";
};

const DEFAULT_PLACEHOLDER: LetterboxGradientPair = { top: "#1f2937", bottom: "#111827" };

export function normalizeHexForCompare(input: string | undefined | null): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s.startsWith("#") || s.length < 4) return null;
  const core = s.slice(1);
  const hex =
    core.length === 3
      ? `#${core[0]}${core[0]}${core[1]}${core[1]}${core[2]}${core[2]}`.toLowerCase()
      : s.length >= 7
        ? `#${core.slice(0, 6)}`.toLowerCase()
        : null;
  return hex && /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

/** True for publisher defaults and other generic dark placeholders — never treat as "real" client gradients. */
export function isPlaceholderLetterboxGradient(gradient: {
  top?: string | null;
  bottom?: string | null;
  source?: string | null;
} | null | undefined): boolean {
  if (!gradient || typeof gradient !== "object") return true;
  if (gradient.source === "placeholder") return true;
  const t = normalizeHexForCompare(gradient.top ?? "");
  const b = normalizeHexForCompare(gradient.bottom ?? "");
  if (!t || !b) return true;
  if (t === "#1f2937" && b === "#111827") return true;
  if (t === "#111827" && b === "#111827") return true;
  return false;
}

function parseLetterboxPairs(raw: unknown): LetterboxGradientPair[] {
  if (!Array.isArray(raw)) return [];
  const out: LetterboxGradientPair[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (o.source === "placeholder") continue;
    const top = typeof o.top === "string" ? o.top.trim() : "";
    const bottom = typeof o.bottom === "string" ? o.bottom.trim() : "";
    const cand = { top, bottom };
    if (!top || !bottom) continue;
    if (isPlaceholderLetterboxGradient(cand)) continue;
    out.push(cand);
  }
  return out;
}

function parsePresentationGradient(raw: unknown): LetterboxGradientPair | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.source === "placeholder") return null;
  const top = typeof o.top === "string" ? o.top.trim() : "";
  const bottom = typeof o.bottom === "string" ? o.bottom.trim() : "";
  const cand = { top, bottom };
  if (!top || !bottom || isPlaceholderLetterboxGradient(cand)) return null;
  return cand;
}

function parseAssetPresentations(raw: unknown): Map<number, AssetPresentationPublish> {
  const map = new Map<number, AssetPresentationPublish>();
  if (!Array.isArray(raw)) return map;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const index = typeof o.index === "number" && Number.isFinite(o.index) ? Math.floor(o.index) : Number.NaN;
    if (index < 0 || index > 79) continue;
    const pres = o.presentation;
    if (!pres || typeof pres !== "object") continue;
    const p = pres as Record<string, unknown>;
    const lg = parsePresentationGradient(p.letterboxGradient);
    const carouselFitWidth = typeof p.carouselFitWidth === "boolean" ? p.carouselFitWidth : undefined;
    const resizeMode = p.resizeMode === "contain" || p.resizeMode === "cover" ? p.resizeMode : undefined;
    const block: AssetPresentationPublish = {
      ...(lg ? { letterboxGradient: lg } : {}),
      ...(carouselFitWidth !== undefined ? { carouselFitWidth } : {}),
      ...(resizeMode ? { resizeMode } : {})
    };
    if (Object.keys(block).length > 0) map.set(index, block);
  }
  return map;
}

function gradientsFromAssetPresentationMap(map: Map<number, AssetPresentationPublish>, assetCount: number): LetterboxGradientPair[] | null {
  if (map.size === 0 || assetCount <= 0) return null;
  const out: LetterboxGradientPair[] = [];
  for (let i = 0; i < assetCount; i += 1) {
    const g = map.get(i)?.letterboxGradient;
    if (!g) return null;
    out.push(g);
  }
  return out.length === assetCount ? out : null;
}

function tryBlurhashDerivedGradients(_blurhashes: string[] | undefined): LetterboxGradientPair[] | null {
  void _blurhashes;
  return null;
}

export type SelectPublishLetterboxGradientsInput = {
  assetCount: number;
  bodyLetterboxGradients?: unknown;
  stagingLetterboxGradients?: unknown;
  bodyCarouselFitWidth?: unknown;
  stagingCarouselFitWidth?: unknown;
  bodyAssetPresentations?: unknown;
  stagingAssetPresentations?: unknown;
  assetBlurhashes?: string[];
  fallbackAllowed?: boolean;
};

export type SelectPublishLetterboxGradientsResult = {
  letterboxGradients: LetterboxGradientPair[];
  carouselFitWidth: boolean;
  perAssetPresentation: AssetPresentationPublish[];
  usedPlaceholderGradient: boolean;
  placeholderReason: string | null;
  selectedSourceBeforeWrite: string;
};

export function selectPublishLetterboxGradients(input: SelectPublishLetterboxGradientsInput): SelectPublishLetterboxGradientsResult {
  const assetCount = Math.max(0, Math.floor(input.assetCount));
  const fallbackAllowed = input.fallbackAllowed !== false;

  const bodyPairs = parseLetterboxPairs(input.bodyLetterboxGradients);
  const stagingPairs = parseLetterboxPairs(input.stagingLetterboxGradients);
  const bodyPresMap = parseAssetPresentations(input.bodyAssetPresentations);
  const stagingPresMap = parseAssetPresentations(input.stagingAssetPresentations);

  let selectedSourceBeforeWrite = "fallback_default";
  let letterboxGradients: LetterboxGradientPair[] = [];

  const tryPick = (): boolean => {
    if (bodyPairs.length > 0) {
      letterboxGradients = bodyPairs;
      selectedSourceBeforeWrite =
        bodyPairs.length === 1 && assetCount > 1 ? "body_letterbox_global" : "body_letterbox_gradients";
      return true;
    }
    const bodyFromPres = gradientsFromAssetPresentationMap(bodyPresMap, assetCount);
    if (bodyFromPres) {
      letterboxGradients = bodyFromPres;
      selectedSourceBeforeWrite = "body_asset_presentation";
      return true;
    }
    if (stagingPairs.length > 0) {
      letterboxGradients = stagingPairs;
      selectedSourceBeforeWrite =
        stagingPairs.length === 1 && assetCount > 1 ? "staging_letterbox_global" : "staging_letterbox_gradients";
      return true;
    }
    const stagingFromPres = gradientsFromAssetPresentationMap(stagingPresMap, assetCount);
    if (stagingFromPres) {
      letterboxGradients = stagingFromPres;
      selectedSourceBeforeWrite = "staging_asset_presentation";
      return true;
    }
    const blur = tryBlurhashDerivedGradients(input.assetBlurhashes);
    if (blur && blur.length > 0) {
      letterboxGradients = blur;
      selectedSourceBeforeWrite = "blurhash_derived";
      return true;
    }
    return false;
  };

  const picked = tryPick();
  let usedPlaceholderGradient = false;
  let placeholderReason: string | null = null;

  if (!picked || letterboxGradients.length === 0) {
    if (fallbackAllowed) {
      letterboxGradients = [{ ...DEFAULT_PLACEHOLDER }];
      usedPlaceholderGradient = true;
      placeholderReason = "no_non_placeholder_gradient_inputs";
      selectedSourceBeforeWrite = "fallback_placeholder";
    } else {
      letterboxGradients = [];
      usedPlaceholderGradient = false;
      placeholderReason = "omitted_no_fallback";
      selectedSourceBeforeWrite = "omitted";
    }
  }

  const carouselFitWidth =
    typeof input.bodyCarouselFitWidth === "boolean"
      ? input.bodyCarouselFitWidth
      : typeof input.stagingCarouselFitWidth === "boolean"
        ? input.stagingCarouselFitWidth
        : true;

  const primaryPresMap =
    bodyPresMap.size > 0 ? bodyPresMap : stagingPresMap.size > 0 ? stagingPresMap : new Map<number, AssetPresentationPublish>();

  const perAssetPresentation: AssetPresentationPublish[] = [];
  for (let i = 0; i < assetCount; i += 1) {
    const hinted = primaryPresMap.get(i);
    let gradient: LetterboxGradientPair | undefined = hinted?.letterboxGradient;
    if (!gradient && letterboxGradients.length === assetCount) {
      gradient = letterboxGradients[i];
    } else if (!gradient && letterboxGradients.length === 1) {
      gradient = letterboxGradients[0];
    } else if (!gradient && letterboxGradients.length > 1) {
      gradient = letterboxGradients[Math.min(i, letterboxGradients.length - 1)];
    }

    const fit =
      typeof hinted?.carouselFitWidth === "boolean"
        ? hinted.carouselFitWidth
        : carouselFitWidth;

    const resizeMode: "contain" | "cover" =
      hinted?.resizeMode === "cover"
        ? "cover"
        : fit
          ? "contain"
          : "cover";

    perAssetPresentation.push({
      ...(gradient ? { letterboxGradient: gradient } : {}),
      carouselFitWidth: fit,
      resizeMode
    });
  }

  return {
    letterboxGradients,
    carouselFitWidth,
    perAssetPresentation,
    usedPlaceholderGradient,
    placeholderReason,
    selectedSourceBeforeWrite
  };
}

/** Merge selected carousel letterbox presentation onto assembled assets (Firestore + AppPostV2). */
export function applyPublishPresentationToAssembledAssets(
  assets: Record<string, unknown>[],
  perAssetPresentation: AssetPresentationPublish[]
): void {
  for (let i = 0; i < assets.length; i += 1) {
    const row = assets[i];
    if (!row || typeof row !== "object") continue;
    const pres = perAssetPresentation[i];
    if (!pres) continue;
    const prev =
      row.presentation && typeof row.presentation === "object"
        ? (row.presentation as Record<string, unknown>)
        : {};
    const next: Record<string, unknown> = { ...prev };
    if (pres.letterboxGradient) next.letterboxGradient = pres.letterboxGradient;
    if (pres.carouselFitWidth !== undefined) next.carouselFitWidth = pres.carouselFitWidth;
    if (pres.resizeMode) next.resizeMode = pres.resizeMode;
    row.presentation = next;
  }
}
