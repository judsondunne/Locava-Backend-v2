import type { AppEnv } from "../../config/env.js";
import type {
  ParsedPlaceQuery,
  PlaceImageResult,
  PlaceWithPhotos,
} from "../../types/places.js";
import { filterAcceptablePlaceImages } from "./placeImageQualityFilter.js";
import { enrichPlaceImageCitation, enrichPlaceImageResults } from "./placeImageCitation.js";
import { filterVerifiedLoadableImages } from "./placeImageEmbedPolicy.js";
import {
  filterRelevantPlaceImages,
  rankPlaceImages,
  resolveRegionAndFeature,
} from "./placeImageRanking.js";

const MOCK_PLACE_IMAGES: Record<string, Omit<PlaceImageResult, "id">[]> = {
  "Easton Canal Museum": [
    {
      imageUrl:
        "https://images.unsplash.com/photo-1547036967-23d11aacaee0?auto=format&fit=crop&w=640&q=80",
      caption:
        "The National Canal Museum along the Lehigh Canal in Hugh Moore Park, Easton, Pennsylvania.",
      sourceName: "National Canal Museum",
      sourceUrl: "https://canals.org/visit/national-canal-museum/",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=640&q=80",
      caption:
        "Historic Lehigh Canal towpath near Easton — once a vital artery of Pennsylvania industry.",
      sourceName: "Delaware & Lehigh National Heritage Corridor",
      sourceUrl: "https://delawareandlehigh.org/",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=640&q=80",
      caption:
        "Canal heritage landscape along the Delaware & Lehigh corridor in the Easton region.",
      sourceName: "Visit PA",
      sourceUrl: "https://www.visitpa.com/",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=640&q=80",
      caption:
        "Hugh Moore Park and riverside trails connecting Easton's canal history to the Lehigh River.",
      sourceName: "Atlas Obscura",
      sourceUrl: "https://www.atlasobscura.com/places/national-canal-museum",
    },
  ],
  "Quechee Gorge Vermont": [
    {
      imageUrl:
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=640&q=80",
      caption:
        "Quechee Gorge — Vermont's 'Little Grand Canyon' carved by the Ottauquechee River.",
      sourceName: "Vermont State Parks",
      sourceUrl: "https://vtstateparks.com/quechee.html",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1464822759844-d150baec0134?auto=format&fit=crop&w=640&q=80",
      caption:
        "U.S. Route 4 bridge spanning the 165-foot-deep Quechee Gorge in Hartford, Vermont.",
      sourceName: "Wikimedia Commons",
      sourceUrl: "https://commons.wikimedia.org/wiki/Category:Quechee_Gorge",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1439068796017-5861f0f04a66?auto=format&fit=crop&w=640&q=80",
      caption:
        "The Ottauquechee River flowing through the gorge below the visitor overlook.",
      sourceName: "Vermont Tourism",
      sourceUrl: "https://www.vermontvacation.com/",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=640&q=80",
      caption:
        "Fall foliage framing the Quechee Gorge overlook — a classic Vermont scenic vista.",
      sourceName: "Quechee Gorge Village",
      sourceUrl: "https://www.quecheegorge.com/",
    },
  ],
  "Woodstock Vermont": [
    {
      imageUrl:
        "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=640&q=80",
      caption:
        "The iconic village green at the heart of historic Woodstock, Vermont.",
      sourceName: "Woodstock Vermont Chamber",
      sourceUrl: "https://www.woodstockvt.com/",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1506197603052-6fc6c079698a?auto=format&fit=crop&w=640&q=80",
      caption:
        "Autumn colors along Woodstock's Main Street — one of New England's prettiest towns.",
      sourceName: "Vermont Tourism",
      sourceUrl: "https://www.vermontvacation.com/destinations/woodstock",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=640&q=80",
      caption:
        "Billings Farm & Museum — a working farm and living history museum in Woodstock.",
      sourceName: "Billings Farm & Museum",
      sourceUrl: "https://billingsfarm.org/",
    },
    {
      imageUrl:
        "https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=640&q=80",
      caption:
        "The Middle Covered Bridge crossing the Ottauquechee River in downtown Woodstock.",
      sourceName: "Wikimedia Commons",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/Category:Covered_bridges_in_Woodstock,_Vermont",
    },
  ],
};

const DEFAULT_RESULT_TARGET = 4;
const FETCH_POOL_SIZE = 20;

export type SearchPlaceImagesOptions = {
  resultLimit?: number;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function finalizePlaceImageResults(
  raw: PlaceImageResult[],
  query: ParsedPlaceQuery,
  provider: "bing" | "serper" | "mock",
  resultLimit = DEFAULT_RESULT_TARGET,
): Promise<PlaceImageResult[]> {
  const relevant = filterRelevantPlaceImages(raw, query);
  const photos = filterAcceptablePlaceImages(relevant);

  return filterVerifiedLoadableImages(photos).then((loadable) =>
    rankPlaceImages(loadable, query)
      .slice(0, Math.max(1, Math.min(resultLimit, 20)))
      .map((result, index) =>
        enrichPlaceImageCitation(
          {
            ...result,
            id: `${slugify(query.displayName)}-photo-${index + 1}`,
          },
          provider,
        ),
      ),
  );
}

function withIds(
  placeName: string,
  items: Omit<PlaceImageResult, "id">[],
): PlaceImageResult[] {
  const slug = slugify(placeName);
  return items.map((item, index) => ({
    ...item,
    id: `${slug}-${index + 1}`,
  }));
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

async function fetchFromSerper(
  searchQuery: string,
  apiKey: string,
  limit = 4,
): Promise<PlaceImageResult[]> {
  const response = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: searchQuery, num: Math.min(Math.max(limit, 4), 20) }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Serper image search failed (${response.status})`);
  }

  const data = (await response.json()) as {
    images?: Array<{
      title?: string;
      imageUrl?: string;
      link?: string;
      source?: string;
      imageWidth?: number;
      imageHeight?: number;
    }>;
  };

  const images = Array.isArray(data.images) ? data.images : [];
  return images
    .filter((item) => item.imageUrl)
    .map((item, index) => {
      const sourceUrl = item.link || item.imageUrl!;
      return {
        id: `${slugify(searchQuery)}-serper-${index + 1}`,
        imageUrl: item.imageUrl!,
        caption: item.title?.trim() || `Image result for ${searchQuery}`,
        sourceName: item.source?.trim() || extractHostname(sourceUrl),
        sourceUrl,
        imageWidth: item.imageWidth,
        imageHeight: item.imageHeight,
      };
    });
}

async function fetchFromBing(
  searchQuery: string,
  apiKey: string,
  limit = 4,
): Promise<PlaceImageResult[]> {
  const url = new URL("https://api.bing.microsoft.com/v7.0/images/search");
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("count", String(Math.min(Math.max(limit, 4), 20)));
  url.searchParams.set("safeSearch", "Strict");
  url.searchParams.set("license", "Public");

  const response = await fetch(url.toString(), {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Bing image search failed (${response.status})`);
  }

  const data = (await response.json()) as {
    value?: Array<{
      contentUrl?: string;
      name?: string;
      hostPageUrl?: string;
      hostPageDisplayUrl?: string;
    }>;
  };

  const hits = Array.isArray(data.value) ? data.value : [];
  return hits
    .filter((item) => item.contentUrl)
    .map((item, index) => {
      const sourceUrl = item.hostPageUrl || item.contentUrl!;
      return {
        id: `${slugify(searchQuery)}-bing-${index + 1}`,
        imageUrl: item.contentUrl!,
        caption: item.name?.trim() || `Image result for ${searchQuery}`,
        sourceName:
          item.hostPageDisplayUrl?.trim() || extractHostname(sourceUrl),
        sourceUrl,
      };
    });
}

const REGION_CONTEXT_ALIASES: Record<string, string[]> = {
  ascutney: ["weathersfield", "windsor", "mount ascutney"],
};

function expandRegionForSearch(region: string): string {
  let expanded = region.trim();
  if (/\bvt\b/i.test(expanded)) {
    expanded = expanded.replace(/\bvt\b/gi, "Vermont");
  }
  return expanded;
}

function buildScopedSearchQuery(region: string, feature: string): string {
  const regionExpanded = expandRegionForSearch(region);
  const extra: string[] = [];
  for (const token of region.toLowerCase().split(/[^a-z0-9]+/)) {
    const aliases = REGION_CONTEXT_ALIASES[token];
    if (aliases) extra.push(...aliases.slice(0, 2));
  }
  return [feature, regionExpanded, ...extra].join(" ");
}

export function buildPlaceQuery(line: string): ParsedPlaceQuery {
  const trimmed = line.trim();
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) {
    return {
      rawLine: trimmed,
      displayName: trimmed,
      searchQuery: trimmed,
      scoped: false,
    };
  }

  const left = trimmed.slice(0, commaIdx).trim();
  const right = trimmed.slice(commaIdx + 1).trim();
  if (!left || !right) {
    return {
      rawLine: trimmed,
      displayName: trimmed,
      searchQuery: trimmed.replace(/,/g, " "),
      scoped: false,
    };
  }

  const { region, feature } = resolveRegionAndFeature(left, right);

  return {
    rawLine: trimmed,
    displayName: `${feature} · ${region}`,
    searchQuery: buildScopedSearchQuery(region, feature),
    scoped: true,
    region,
    feature,
  };
}

export function parsePlaceQueries(input: string): ParsedPlaceQuery[] {
  const seen = new Set<string>();
  const queries: ParsedPlaceQuery[] = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(buildPlaceQuery(trimmed));
  }
  return queries;
}

/** @deprecated Use parsePlaceQueries — kept for callers expecting string names. */
export function parsePlaceNames(input: string): string[] {
  return parsePlaceQueries(input).map((query) => query.rawLine);
}

function mockLookupKey(query: ParsedPlaceQuery): string | undefined {
  const candidates = [query.rawLine, query.displayName, query.searchQuery];
  for (const key of candidates) {
    if (MOCK_PLACE_IMAGES[key]) return key;
  }
  return undefined;
}

export function hasPlaceImageSearchApiKey(env: AppEnv): boolean {
  return Boolean(
    String(env.SERPER_API_KEY ?? "").trim() ||
      String(env.BING_SEARCH_API_KEY ?? "").trim(),
  );
}

export async function searchPlaceImages(
  query: ParsedPlaceQuery | string,
  env: AppEnv,
  options?: SearchPlaceImagesOptions,
): Promise<{ results: PlaceImageResult[]; source: "bing" | "serper" | "mock" }> {
  const parsed =
    typeof query === "string" ? buildPlaceQuery(query) : query;
  const resultLimit = options?.resultLimit ?? DEFAULT_RESULT_TARGET;
  const serperKey = String(env.SERPER_API_KEY ?? "").trim();
  const bingKey = String(env.BING_SEARCH_API_KEY ?? "").trim();

  if (serperKey) {
    const raw = await fetchFromSerper(parsed.searchQuery, serperKey, FETCH_POOL_SIZE);
    const results = await finalizePlaceImageResults(raw, parsed, "serper", resultLimit);
    if (results.length > 0) {
      return { results, source: "serper" };
    }
  }

  if (bingKey) {
    const raw = await fetchFromBing(parsed.searchQuery, bingKey, FETCH_POOL_SIZE);
    const results = await finalizePlaceImageResults(raw, parsed, "bing", resultLimit);
    if (results.length > 0) {
      return { results, source: "bing" };
    }
  }

  const mockKey = mockLookupKey(parsed);
  if (mockKey) {
    return {
      results: enrichPlaceImageResults(
        withIds(parsed.displayName, MOCK_PLACE_IMAGES[mockKey]!),
        "mock",
      ),
      source: "mock",
    };
  }

  return { results: [], source: "mock" };
}

function notFoundMessage(query: ParsedPlaceQuery, env: AppEnv): string {
  return hasPlaceImageSearchApiKey(env)
    ? `No image results found for "${query.displayName}".`
    : `No mock results for "${query.displayName}". Try one of the preset locations or configure SERPER_API_KEY / BING_SEARCH_API_KEY.`;
}

export async function searchMultiplePlaceImages(
  queries: ParsedPlaceQuery[],
  env: AppEnv,
): Promise<PlaceWithPhotos[]> {
  return Promise.all(
    queries.map(async (query) => {
      try {
        const { results, source } = await searchPlaceImages(query, env);
        if (results.length === 0) {
          return {
            placeName: query.displayName,
            searchQuery: query.searchQuery,
            results,
            source,
            error: notFoundMessage(query, env),
          };
        }
        return {
          placeName: query.displayName,
          searchQuery: query.searchQuery,
          results,
          source,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Image search provider error.";
        return {
          placeName: query.displayName,
          searchQuery: query.searchQuery,
          results: [],
          source: "mock" as const,
          error: message,
        };
      }
    }),
  );
}
