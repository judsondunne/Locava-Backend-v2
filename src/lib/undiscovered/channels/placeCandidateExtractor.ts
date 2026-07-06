import {
  normalizeDiscoveryCategory,
  type DiscoveryCandidate,
  type DiscoverySpotCategory,
} from "../../../contracts/surfaces/undiscovered-candidate.contract.js";
import type { DiscoverySourceChannel } from "../../../contracts/surfaces/undiscovered-candidate.contract.js";
import type { RawDiscoveryItem } from "./types.js";

/**
 * Shared, source-independent place extraction + relevance gating.
 *
 * Turns free text (Reddit titles, blog paragraphs, IG captions) into candidate
 * place names, and drops anything that isn't plausibly in the target region.
 * The relevance gate is the guard against "irrelevant locations" the plan calls
 * out — text sources are only kept when they carry a regional signal (in-bbox
 * coords, or a Vermont keyword / known town).
 */

export const VERMONT_BBOX = { minLat: 42.72, minLng: -73.44, maxLat: 45.02, maxLng: -71.46 };

/** Well-known Vermont towns/areas used as a text relevance signal. */
const VERMONT_KEYWORDS = [
  "vermont",
  " vt ",
  "stowe",
  "burlington",
  "warren",
  "bristol",
  "middlebury",
  "woodstock",
  "quechee",
  "killington",
  "waterbury",
  "montpelier",
  "manchester",
  "brattleboro",
  "bennington",
  "rutland",
  "mansfield",
  "camel's hump",
  "green mountain",
  "smugglers",
  "mad river",
];

/**
 * Trailing feature-type → (category, kind). Anchored to the END of the name, so
 * "Quechee Gorge Trail" is a route (trail), not a gorge — the last word is the
 * actual feature type.
 */
const TYPE_KEYWORDS: Array<{ re: RegExp; category: string; kind: "spot" | "route" }> = [
  { re: /(trails?|paths?)$/i, category: "hiking_trail", kind: "route" },
  { re: /(waterfalls?|falls)$/i, category: "waterfall", kind: "spot" },
  { re: /(swimming\s+hole|swimhole|hole)$/i, category: "swimming_hole", kind: "spot" },
  { re: /(gorges?|canyons?|ravines?)$/i, category: "gorge_canyon", kind: "spot" },
  { re: /(lakes?|ponds?|reservoirs?)$/i, category: "lake_pond", kind: "spot" },
  { re: /(rivers?|brooks?|creeks?|streams?)$/i, category: "river_stream", kind: "spot" },
  { re: /(mountains?|mtn|peaks?|summits?)$/i, category: "summit_viewpoint", kind: "spot" },
  { re: /(overlooks?|vistas?|lookouts?)$/i, category: "scenic_overlook", kind: "spot" },
  { re: /(caves?|caverns?)$/i, category: "cave", kind: "spot" },
  { re: /(beach(es)?)$/i, category: "beach", kind: "spot" },
  { re: /(state\s+park|state\s+forest|park)$/i, category: "park", kind: "spot" },
];

/** Matches "Capitalized Name … <Type>" phrases, e.g. "Warren Falls", "Quechee Gorge Trail". */
const PLACE_RE =
  /\b([A-Z][a-zA-Z'’]+(?:\s+[A-Z][a-zA-Z'’]+){0,3}\s+(?:Falls|Waterfall|Gorge|Canyon|Ravine|Trail|Path|Lake|Pond|Reservoir|River|Brook|Creek|Stream|Mountain|Mtn|Peak|Summit|Overlook|Vista|Lookout|Cave|Cavern|Beach|Ledge|Cliff|Hole))\b/g;

export interface ExtractedPlace {
  name: string;
  category: DiscoverySpotCategory;
  kind: "spot" | "route";
  confidence: number;
}

/** Leading descriptors that aren't part of a place name (kept size/direction words like "Little", "Upper"). */
const LEADING_STOPWORDS = new Set([
  "the", "a", "an", "hidden", "secret", "best", "amazing", "beautiful",
  "stunning", "gorgeous", "epic", "favorite", "favourite", "my", "this", "our",
]);

function trimLeadingStopwords(name: string): string {
  const words = name.split(" ");
  while (words.length > 2 && LEADING_STOPWORDS.has(words[0]!.toLowerCase())) {
    words.shift();
  }
  return words.join(" ");
}

function classify(name: string): { category: string; kind: "spot" | "route" } {
  for (const t of TYPE_KEYWORDS) {
    if (t.re.test(name)) return { category: t.category, kind: t.kind };
  }
  return { category: "other", kind: "spot" };
}

/** Extract candidate place names from a blob of text. Deduped by lowercased name. */
export function extractPlaceCandidatesFromText(text: string): ExtractedPlace[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: ExtractedPlace[] = [];
  for (const m of text.matchAll(PLACE_RE)) {
    const cap = m[1];
    if (!cap) continue;
    const name = trimLeadingStopwords(cap.replace(/\s+/g, " ").trim());
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const { category, kind } = classify(name);
    const wordCount = name.split(" ").length;
    const confidence = Math.min(0.9, 0.55 + (wordCount >= 3 ? 0.25 : wordCount === 2 ? 0.15 : 0));
    out.push({ name, category: normalizeDiscoveryCategory(category), kind, confidence });
  }
  return out;
}

/** Region relevance gate. In-bbox coords pass; text-only items need a regional keyword. */
export function isRegionRelevant(item: RawDiscoveryItem, region: string): boolean {
  if (region.toUpperCase() !== "VT") return true; // only Vermont is gated in v1
  if (typeof item.lat === "number" && typeof item.lng === "number") {
    return (
      item.lat >= VERMONT_BBOX.minLat &&
      item.lat <= VERMONT_BBOX.maxLat &&
      item.lng >= VERMONT_BBOX.minLng &&
      item.lng <= VERMONT_BBOX.maxLng
    );
  }
  const hay = ` ${(item.text || "").toLowerCase()} ${(item.sourceUrl || "").toLowerCase()} `;
  return VERMONT_KEYWORDS.some((k) => hay.includes(k));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Map raw source items into discovery candidates for a channel: relevance-gate,
 * extract place names, and build one candidate per (item, place). Text-derived
 * candidates start as `candidate` and pass the quality gate (a human still reviews);
 * confidence is recorded in `qualityGate.reasons` for transparency.
 */
export function itemsToChannelCandidates(
  items: RawDiscoveryItem[],
  opts: { channel: DiscoverySourceChannel; region: string; nowIso?: string; sourceProvider: string },
): DiscoveryCandidate[] {
  const now = opts.nowIso ?? new Date().toISOString();
  const out: DiscoveryCandidate[] = [];
  const seenIds = new Set<string>();
  for (const item of items) {
    if (!isRegionRelevant(item, opts.region)) continue;
    for (const place of extractPlaceCandidatesFromText(item.text)) {
      const id = `${opts.channel}:${item.sourceId}:${slug(place.name)}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      out.push({
        id,
        region: opts.region,
        sourceChannel: opts.channel,
        kind: place.kind,
        targetCollection: place.kind === "route" ? "unexploredRoutes" : "unexploredSpots",
        displayName: place.name,
        primaryCategory: place.category,
        categories: [place.category],
        primaryActivity: null,
        activities: [],
        lat: item.lat ?? 0,
        lng: item.lng ?? 0,
        reviewStatus: "candidate",
        qualityGate: {
          passed: true,
          reasons: [`text_extracted`, `confidence_${place.confidence.toFixed(2)}`],
        },
        provenance: {
          sourceProvider: opts.sourceProvider,
          sourceIds: [item.sourceId],
          sourceKeys: [],
          sourceUrl: item.sourceUrl,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return out;
}
