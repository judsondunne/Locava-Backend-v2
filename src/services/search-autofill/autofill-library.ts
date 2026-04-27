import autofillLibrary from "./autofill-library.json";
import type { PrefixFrame } from "./autofill-intent.js";
import { getPrefixFrame } from "./autofill-intent.js";

export type ViewerPlaceContext = {
  cityName: string | null;
  stateName: string | null;
  cityRegionId: string | null;
  stateRegionId: string | null;
};

export type LibrarySuggestion = {
  text: string;
  type: "smart_completion" | "natural_echo" | "town" | "state" | "sentence";
  data?: Record<string, unknown>;
  confidence: number;
};

const library = autofillLibrary as {
  starters?: string[];
  triggerPrefixes: Record<string, string[]>;
  buckets: Record<string, string[]>;
  familyFromTrigger: Record<string, string>;
};

function normalizeForMatch(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

function matchFamily(query: string): string | null {
  const normalized = normalizeForMatch(query);
  if (!normalized) return null;
  const triggers = library.familyFromTrigger;
  let bestKey: string | null = null;
  let bestLen = 0;
  for (const key of Object.keys(triggers)) {
    const keyNorm = key.toLowerCase();
    if (normalized.startsWith(keyNorm) || keyNorm.startsWith(normalized) || normalized.includes(keyNorm)) {
      if (key.length > bestLen) {
        bestLen = key.length;
        bestKey = key;
      }
    }
  }
  return bestKey ? (triggers[bestKey] as string) : null;
}

function expandTemplate(
  template: string,
  options?: {
    cityName?: string;
    stateName?: string;
    cityRegionId?: string;
    stateRegionId?: string;
    quality?: string;
  },
): { text: string; data?: Record<string, unknown>; isCompletionTemplate?: boolean } {
  let text = template;
  const data: Record<string, unknown> = {};
  const hasQualityPlaceholder = text.includes("[QUALITY]");

  if (text.includes("[QUALITY]")) {
    const qualityPart = options?.quality ? `${options.quality} ` : "";
    text = text
      .replace(/\[QUALITY\]\s*/g, qualityPart)
      .replace(/\s+/g, " ")
      .trim();
  }
  if (options?.cityName && text.includes("[City]")) {
    text = text.replace(/\[City\]/g, options.cityName);
    if (options.cityRegionId) data.cityRegionId = options.cityRegionId;
    if (options.stateRegionId) data.stateRegionId = options.stateRegionId;
  }
  if (options?.stateName && text.includes("[State]")) {
    text = text.replace(/\[State\]/g, options.stateName);
    if (options.stateRegionId) data.stateRegionId = options.stateRegionId;
  }
  return {
    text,
    data: Object.keys(data).length ? data : undefined,
    isCompletionTemplate: hasQualityPlaceholder,
  };
}

function applyPrefix(text: string, frame: PrefixFrame): boolean {
  if (frame.isEmpty) return true;
  const norm = frame.normalized.toLowerCase();
  const t = text.toLowerCase().trim();
  return t.startsWith(norm) || norm.startsWith(t.slice(0, norm.length));
}

export async function getStartersFromLibrary(placeContext?: ViewerPlaceContext | null): Promise<LibrarySuggestion[]> {
  const starters = library.starters;
  if (!starters?.length) return [];
  const out: LibrarySuggestion[] = [];
  const seen = new Set<string>();
  for (const t of starters) {
    const { text, data } = expandTemplate(t, {
      cityName: placeContext?.cityName ?? undefined,
      stateName: placeContext?.stateName ?? undefined,
      cityRegionId: placeContext?.cityRegionId ?? undefined,
      stateRegionId: placeContext?.stateRegionId ?? undefined,
    });
    const key = text.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      text,
      type: data?.cityRegionId ? "town" : "smart_completion",
      data,
      confidence: 0.9,
    });
  }
  return out.slice(0, 12);
}

export async function getSuggestionsFromLibrary(input: {
  query: string;
  placeContext?: ViewerPlaceContext | null;
}): Promise<LibrarySuggestion[]> {
  const query = String(input.query ?? "");
  const frame = getPrefixFrame(query);
  if (frame.isEmpty && library.starters?.length) {
    return getStartersFromLibrary(input.placeContext);
  }

  const family = matchFamily(query);
  if (!family) return [];
  const templates = library.buckets[family];
  if (!templates || templates.length === 0) return [];

  const place = input.placeContext ?? null;
  const opts = {
    cityName: place?.cityName ?? undefined,
    stateName: place?.stateName ?? undefined,
    cityRegionId: place?.cityRegionId ?? undefined,
    stateRegionId: place?.stateRegionId ?? undefined,
    quality: frame.quality || undefined,
  };

  const nearMeTemplates = templates.filter((t) => /near me|within |nearby/i.test(t));
  const cityStateTemplates = templates.filter((t) => t.includes("[City]") || t.includes("[State]") || /in \[city\]|in \[state\]/i.test(t));
  const otherTemplates = templates.filter((t) => !nearMeTemplates.includes(t) && !cityStateTemplates.includes(t));

  const out: LibrarySuggestion[] = [];
  const seen = new Set<string>();

  const add = (text: string, data?: Record<string, unknown>, confidence = 0.9) => {
    if (!applyPrefix(text, frame)) return;
    const key = text.toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      text,
      type: data?.cityRegionId ? "town" : "smart_completion",
      data: Object.keys(data ?? {}).length ? data : undefined,
      confidence,
    });
  };

  for (const t of nearMeTemplates.slice(0, 7)) {
    if (out.length >= 12) break;
    const { text } = expandTemplate(t, opts);
    add(text, undefined, 0.95);
  }

  if (out.length < 6) {
    for (const t of templates) {
      if (out.length >= 8) break;
      if (t.toLowerCase().includes("near me")) {
        const { text } = expandTemplate(t, opts);
        add(text, undefined, 0.9);
      }
    }
  }

  if (place?.cityName && place?.stateName) {
    for (const t of cityStateTemplates) {
      if (out.length >= 12) break;
      const { text, data } = expandTemplate(t, opts);
      add(text, data, 0.88);
    }
    for (const t of nearMeTemplates.slice(0, 3)) {
      if (out.length >= 12) break;
      const withCity = t.replace(/ near me/g, ` in ${place.cityName}`);
      if (!withCity || withCity === t) continue;
      const { text } = expandTemplate(withCity, opts);
      add(text, { cityRegionId: place.cityRegionId ?? undefined, stateRegionId: place.stateRegionId ?? undefined }, 0.85);
    }
  }

  for (const t of otherTemplates) {
    if (out.length >= 12) break;
    const { text } = expandTemplate(t, opts);
    add(text, undefined, 0.8);
  }

  return out.slice(0, 12);
}

