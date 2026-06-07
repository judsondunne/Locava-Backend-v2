import type { PlaceImageResult } from "../../types/places.js";

export type PlaceImageProvider = "bing" | "serper" | "mock";

const PROVIDER_ATTRIBUTION: Record<
  PlaceImageProvider,
  { licenseNote: string; copyrightDisclaimer: string }
> = {
  serper: {
    licenseNote:
      "Images indexed via Google Image Search (Serper). License and reuse terms vary by the linked source page.",
    copyrightDisclaimer:
      "Image rights belong to the listed source site and photographer. Locava shows thumbnails with attribution links only; verify usage rights on the source page before reuse or republication.",
  },
  bing: {
    licenseNote:
      "Images indexed via Bing Image Search (Public license filter). Confirm license on the source page before reuse.",
    copyrightDisclaimer:
      "Image rights belong to the listed source site and photographer. Locava shows thumbnails with attribution links only; verify usage rights on the source page before reuse or republication.",
  },
  mock: {
    licenseNote: "Mock/demo image for local development without API keys.",
    copyrightDisclaimer:
      "Mock results are placeholders only. Do not use in production without real provider results and source attribution.",
  },
};

export function extractSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function enrichPlaceImageCitation(
  result: PlaceImageResult,
  provider: PlaceImageProvider,
): PlaceImageResult {
  const sourceDomain = extractSourceDomain(result.sourceUrl);
  const attribution = PROVIDER_ATTRIBUTION[provider];

  return {
    ...result,
    title: result.caption,
    sourceDomain: sourceDomain || undefined,
    provider,
    backlinkUrl: result.sourceUrl,
    licenseNote: attribution.licenseNote,
    copyrightDisclaimer: attribution.copyrightDisclaimer,
  };
}

export function enrichPlaceImageResults(
  results: PlaceImageResult[],
  provider: PlaceImageProvider,
): PlaceImageResult[] {
  return results.map((result) => enrichPlaceImageCitation(result, provider));
}
