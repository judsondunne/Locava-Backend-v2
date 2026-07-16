/**
 * Wikimedia Commons geosearch photos.
 *
 * Finds freely-licensed photos geotagged near a coordinate — location-verified
 * in a way name-search can never be (a photo taken 80m from the waterfall IS
 * the waterfall). Confidence is distance-based, so genuinely nearby photos
 * legitimately clear the display floor. Results are mapped into the same
 * photoSearch cache-item shape the Serper pipeline writes, with proper
 * artist/license attribution (Commons requires it and we already render it).
 *
 * HTTP is injectable for offline tests. Commons API needs no key; be polite
 * (small batches, modest concurrency).
 */

export type CommonsPhoto = {
  title: string;
  distanceMeters: number;
  thumbnailUrl: string;
  imageUrl: string;
  descriptionUrl: string;
  width: number | null;
  height: number | null;
  artist: string | null;
  license: string | null;
};

export type CommonsDeps = {
  httpGetJson?: (url: string) => Promise<unknown>;
  userAgent?: string;
};

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const DEFAULT_UA = "LocavaBackend/1.0 (undiscovered spots photo backfill)";

async function defaultHttpGetJson(url: string, userAgent: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`commons_${res.status}`);
  return res.json();
}

/** Distance → confidence: closer geotag = stronger evidence it's the place. */
export function commonsDistanceConfidence(distanceMeters: number): number {
  if (distanceMeters <= 100) return 75;
  if (distanceMeters <= 250) return 65;
  return 55;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

/** Photos geotagged within `radiusMeters` of (lat, lng), nearest first. */
export async function fetchCommonsPhotosNear(
  lat: number,
  lng: number,
  opts: { radiusMeters?: number; limit?: number } = {},
  deps: CommonsDeps = {},
): Promise<CommonsPhoto[]> {
  const ua = deps.userAgent ?? DEFAULT_UA;
  const get = deps.httpGetJson ?? ((url: string) => defaultHttpGetJson(url, ua));
  const radius = Math.min(2000, Math.max(50, opts.radiusMeters ?? 400));
  const limit = Math.min(20, Math.max(1, opts.limit ?? 8));

  const geo = (await get(
    `${COMMONS_API}?action=query&list=geosearch&gscoord=${lat}%7C${lng}&gsradius=${radius}&gsnamespace=6&gslimit=${limit}&format=json&origin=*`,
  )) as { query?: { geosearch?: Array<{ title?: string; dist?: number }> } };
  const found = (geo?.query?.geosearch ?? []).filter(
    (g): g is { title: string; dist: number } => typeof g.title === "string" && g.title.startsWith("File:"),
  );
  if (found.length === 0) return [];

  const titles = found.map((f) => f.title).join("|");
  const info = (await get(
    `${COMMONS_API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=640&format=json&origin=*`,
  )) as { query?: { pages?: Record<string, { title?: string; imageinfo?: Array<Record<string, unknown>> }> } };

  const byTitle = new Map<string, Record<string, unknown>>();
  for (const page of Object.values(info?.query?.pages ?? {})) {
    const ii = page.imageinfo?.[0];
    if (page.title && ii) byTitle.set(page.title, ii);
  }

  const out: CommonsPhoto[] = [];
  for (const f of found) {
    const ii = byTitle.get(f.title);
    if (!ii) continue;
    const url = typeof ii.url === "string" ? ii.url : "";
    // Only actual raster images (skip PDFs/SVGs/audio that live in File: space).
    if (!/\.(jpe?g|png|webp)$/i.test(url)) continue;
    const meta = (ii.extmetadata ?? {}) as Record<string, { value?: string }>;
    out.push({
      title: f.title,
      distanceMeters: f.dist,
      thumbnailUrl: typeof ii.thumburl === "string" ? ii.thumburl : url,
      imageUrl: url,
      descriptionUrl: typeof ii.descriptionurl === "string" ? ii.descriptionurl : url,
      width: typeof ii.width === "number" ? ii.width : null,
      height: typeof ii.height === "number" ? ii.height : null,
      artist: meta.Artist?.value ? stripHtml(meta.Artist.value) : null,
      license: meta.LicenseShortName?.value ?? null,
    });
  }
  return out.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** Map Commons photos into photoSearch cache result items (contract shape). */
export function commonsPhotosToCacheResults(photos: CommonsPhoto[], nowIso: string): Array<Record<string, unknown>> {
  return photos.map((p, i) => ({
    id: `commons_${p.title.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 80)}`,
    rank: i + 1,
    thumbnailUrl: p.thumbnailUrl,
    imageUrl: p.imageUrl,
    sourceUrl: p.descriptionUrl,
    sourceTitle: p.title.replace(/^File:/, ""),
    sourceDomain: "commons.wikimedia.org",
    provider: "wikimedia",
    width: p.width,
    height: p.height,
    attributionText: `${p.artist ?? "Wikimedia Commons"}${p.license ? ` (${p.license})` : ""}, via Wikimedia Commons`,
    license: p.license,
    copyrightNotice: null,
    disclaimer: "Image from Wikimedia Commons under the license shown. Locava does not own or claim this image.",
    confidence: commonsDistanceConfidence(p.distanceMeters),
    validationStatus: "accepted",
    fetchedAt: nowIso,
  }));
}
