import type { WikimediaMvpNormalizedAsset, WikimediaMvpSeedPlace } from "./WikimediaMvpTypes.js";

const SUPPORTED_MIME = /^image\/(jpeg|jpg|png|webp|gif)$/i;
const MIN_AREA = 220 * 220;
const NON_PHOTO_TITLE =
  /map\b|diagram|schematic|flag|logo|seal|coat of arms|painting|illustration|drawing|sketch|engraving|woodcut|postcard|currency|coin\b|manuscript|newspaper|svg\b|vector/i;

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/file:|\.(jpg|jpeg|png|gif|webp)$/gi, " ")
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

function placeTokens(place: WikimediaMvpSeedPlace): string[] {
  return tokens(`${place.placeName} ${place.searchQuery}`);
}

export type WikimediaCandidateFilterResult =
  | { ok: true; relevanceScore: number; qualityScore: number; coolnessScore: number; scores: Record<string, number> }
  | { ok: false; reason: string; detail?: string };

export function scoreWikimediaCandidate(
  place: WikimediaMvpSeedPlace,
  asset: WikimediaMvpNormalizedAsset,
  opts?: { mediaPlaceMatchScore?: number },
): WikimediaCandidateFilterResult {
  if (!SUPPORTED_MIME.test(asset.mime)) {
    return { ok: false, reason: "unsupported format" };
  }
  if (asset.width * asset.height < MIN_AREA) {
    return { ok: false, reason: "low resolution" };
  }
  const text = `${asset.title} ${asset.categories.join(" ")}`.toLowerCase();
  if (NON_PHOTO_TITLE.test(text)) {
    return { ok: false, reason: "non-photographic" };
  }

  const pts = placeTokens(place);
  let textMatch = 0;
  for (const t of pts) {
    if (t.length >= 4 && text.includes(t)) textMatch += 3;
    else if (t.length === 3 && text.includes(t)) textMatch += 1;
  }
  const resolution = Math.min(8, Math.log10(asset.width * asset.height + 10) * 2);
  const coordBonus = asset.lat != null && asset.lon != null ? 2 : 0;
  const outdoor = /trail|mountain|lake|gorge|view|hike|forest|park|ridge|summit|waterfall|beach/i.test(text) ? 2 : 0;
  const metadata = asset.categories.length >= 3 ? 1.5 : asset.categories.length >= 1 ? 0.5 : -0.5;
  const relevanceScore = textMatch + outdoor;
  const qualityScore = resolution + metadata + coordBonus;
  const coolnessScore = outdoor + (asset.height > asset.width ? 1 : 0) + Math.min(3, textMatch / 3);
  const scores = {
    textMatch,
    resolution,
    coordinates: coordBonus,
    outdoor,
    metadata,
    relevanceScore,
    qualityScore,
    coolnessScore,
  };

  const mentionsPlace = pts.some((t) => t.length > 3 && text.includes(t));
  const matchBoost = typeof opts?.mediaPlaceMatchScore === "number" ? opts.mediaPlaceMatchScore : 0;
  if (asset.categories.length === 0 && !mentionsPlace && coordBonus === 0) {
    if (matchBoost >= 55) {
      // Strong title/category ↔ place match can justify keeping Commons files without categories or geotags.
    } else {
      return { ok: false, reason: "metadata too weak", detail: "no categories and weak place match" };
    }
  }

  return { ok: true, relevanceScore, qualityScore, coolnessScore, scores };
}
