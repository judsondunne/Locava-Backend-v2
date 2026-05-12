import {
  buildCommonsTextHaystack,
  evaluateCommonsPhotoQuality,
} from "./commonsPhotoQualityGate.js";
import type { RejectedCommonsFile } from "./commonsPhotoQualityGate.js";
import { haversineMiles } from "./geoDistance.js";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const COMMONS_UA =
  "LocavaCommonsByDateDev/1.0 (https://locava.com; see https://meta.wikimedia.org/wiki/User-Agent_policy)";

export type CommonsByDateItem = {
  title: string;
  pageUrl: string;
  thumbUrl: string | null;
  fileUrl: string | null;
  mime: string;
  width: number;
  height: number;
  timestamp: string | null;
  dateKey: string;
  lat: number | null;
  lon: number | null;
};

export type CommonsByDateBucket = {
  date: string;
  /** Populated when the same UTC day splits into multiple ≤½-mile clusters. */
  geoHint: string | null;
  items: CommonsByDateItem[];
};

type MwExtVal = { value?: string };
type MwImageInfo = {
  timestamp?: string;
  url?: string;
  thumburl?: string;
  mime?: string;
  width?: number;
  height?: number;
  size?: number;
  descriptionurl?: string;
  extmetadata?: Record<string, MwExtVal>;
};

type MwCoord = { lat?: number; lon?: number };

type MwPage = {
  pageid?: number;
  title?: string;
  imageinfo?: MwImageInfo[];
  coordinates?: MwCoord[];
};

type MwResponse = {
  batchcomplete?: boolean;
  continue?: Record<string, string | number | boolean>;
  query?: { pages?: MwPage[] };
};

function dayKeyFromTimestamp(ts?: string | null): string {
  if (!ts) return "unknown";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

function commonsPageUrl(title: string): string {
  const t = title.replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(t)}`;
}

function pickPrimaryLatLon(page: MwPage): { lat: number; lon: number } | null {
  const coords = Array.isArray(page.coordinates) ? page.coordinates : [];
  for (const c of coords) {
    const lat = typeof c.lat === "number" ? c.lat : Number.NaN;
    const lon = typeof c.lon === "number" ? c.lon : Number.NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}

export function groupCommonsItemsByDate(items: CommonsByDateItem[]): CommonsByDateBucket[] {
  const byDate = new Map<string, CommonsByDateItem[]>();
  for (const it of items) {
    const k = it.dateKey;
    const row = byDate.get(k);
    if (row) row.push(it);
    else byDate.set(k, [it]);
  }
  const dates = [...byDate.keys()].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a);
  });
  const out: CommonsByDateBucket[] = [];
  for (const date of dates) {
    const row = byDate.get(date) ?? [];
    row.sort((x, y) => {
      const tx = x.timestamp ? Date.parse(x.timestamp) : 0;
      const ty = y.timestamp ? Date.parse(y.timestamp) : 0;
      return ty - tx;
    });
    out.push({ date, geoHint: null, items: row });
  }
  return out;
}

/** Same calendar day can yield multiple display groups if GPS spread &gt; ~½ mile (union–find on haversine). */
const SEGMENT_MAX_MILES = 0.5;

function formatCentroid(items: CommonsByDateItem[]): string {
  let sLat = 0;
  let sLon = 0;
  let n = 0;
  for (const it of items) {
    if (it.lat == null || it.lon == null) continue;
    sLat += it.lat;
    sLon += it.lon;
    n += 1;
  }
  if (!n) return "—";
  return `${(sLat / n).toFixed(3)}°, ${(sLon / n).toFixed(3)}°`;
}

function clusterItemsWithinHalfMile(items: CommonsByDateItem[]): CommonsByDateItem[][] {
  const n = items.length;
  if (n === 0) return [];
  const parent = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;

  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!);
    return parent[i]!;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const pt = (i: number) => ({ lat: items[i]!.lat!, lng: items[i]!.lon! });

  for (let i = 0; i < n; i += 1) {
    if (items[i]!.lat == null || items[i]!.lon == null) continue;
    for (let j = i + 1; j < n; j += 1) {
      if (items[j]!.lat == null || items[j]!.lon == null) continue;
      if (haversineMiles(pt(i), pt(j)) <= SEGMENT_MAX_MILES) union(i, j);
    }
  }

  const map = new Map<number, CommonsByDateItem[]>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    const row = map.get(r);
    if (row) row.push(items[i]!);
    else map.set(r, [items[i]!]);
  }

  const clusters = [...map.values()].map((cluster) =>
    [...cluster].sort((a, b) => {
      const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
      const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
      return tb - ta;
    }),
  );
  clusters.sort((a, b) => {
    const maxTs = (arr: CommonsByDateItem[]) =>
      arr.reduce((m, x) => Math.max(m, x.timestamp ? Date.parse(x.timestamp) : 0), 0);
    return maxTs(b) - maxTs(a);
  });
  return clusters;
}

export function buildDateProximitySegments(items: CommonsByDateItem[]): CommonsByDateBucket[] {
  const daily = groupCommonsItemsByDate(items);
  const out: CommonsByDateBucket[] = [];
  for (const { date, items: row } of daily) {
    const clusters = clusterItemsWithinHalfMile(row);
    const multi = clusters.length > 1;
    for (const cluster of clusters) {
      out.push({ date, geoHint: multi ? formatCentroid(cluster) : null, items: cluster });
    }
  }
  return out;
}

async function commonsGetJson(params: Record<string, string>, signal?: AbortSignal): Promise<MwResponse> {
  const url = new URL(COMMONS_API);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { signal, headers: { "user-agent": COMMONS_UA } });
  if (!res.ok) {
    throw new Error(`commons_http_${res.status}`);
  }
  return (await res.json()) as MwResponse;
}

function continueToParams(cont: Record<string, string | number | boolean>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cont)) {
    out[k] = String(v);
  }
  return out;
}

const MAX_API_REQUESTS = 220;
const MAX_REJECTED_SAMPLES = 650;

export type CommonsSearchGroupedSnapshot = {
  query: string;
  requireGeo: boolean;
  groupCount: number;
  totalFetched: number;
  apiRequests: number;
  byDate: CommonsByDateBucket[];
  truncated: boolean;
  rejected: RejectedCommonsFile[];
  rejectedTotal: number;
  geoSkippedCount: number;
  scannedCount: number;
};

type ProcessOutcome =
  | { kind: "silent_geo" }
  | { kind: "reject"; row: RejectedCommonsFile }
  | { kind: "accept"; item: CommonsByDateItem };

function processCommonsPage(
  page: MwPage,
  imagesOnly: boolean,
  requireGeo: boolean,
): ProcessOutcome | null {
  const id = typeof page.pageid === "number" ? page.pageid : 0;
  const title = String(page.title || "").trim();
  if (!id || !title) return null;

  const ii = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined;
  const pageUrl = ii?.descriptionurl ? String(ii.descriptionurl).trim() : commonsPageUrl(title);
  const thumbUrl = ii?.thumburl ? String(ii.thumburl) : null;

  if (!ii) {
    return {
      kind: "reject",
      row: {
        pageId: id,
        title,
        pageUrl,
        thumbUrl,
        reasons: ["Commons returned no image metadata for this file page."],
      },
    };
  }

  const mime = String(ii.mime || "").toLowerCase();
  if (imagesOnly) {
    if (!mime.startsWith("image/") || mime === "image/svg+xml") {
      return {
        kind: "reject",
        row: {
          pageId: id,
          title,
          pageUrl,
          thumbUrl,
          reasons: [`Not a raster photograph (MIME ${mime || "unknown"}; SVG and non-images are skipped).`],
        },
      };
    }
  }

  const geo = pickPrimaryLatLon(page);
  if (requireGeo && !geo) {
    return { kind: "silent_geo" };
  }

  const w = Number(ii.width || 0);
  const h = Number(ii.height || 0);
  const byteSize = typeof ii.size === "number" ? ii.size : 0;
  const ext = ii.extmetadata ?? {};
  const textHaystack = buildCommonsTextHaystack({
    extCategoriesPipe: ext.Categories?.value ?? null,
    objectName: ext.ObjectName?.value ?? null,
    imageDescriptionHtml: ext.ImageDescription?.value ?? null,
  });

  const q = evaluateCommonsPhotoQuality({
    title,
    mime,
    width: w,
    height: h,
    byteSize,
    textHaystack,
  });
  if (!q.ok) {
    return {
      kind: "reject",
      row: {
        pageId: id,
        title,
        pageUrl,
        thumbUrl,
        reasons: q.reasons,
      },
    };
  }

  const ts = ii.timestamp ? String(ii.timestamp) : null;
  return {
    kind: "accept",
    item: {
      title,
      pageUrl,
      thumbUrl,
      fileUrl: ii.url ? String(ii.url) : null,
      mime,
      width: w,
      height: h,
      timestamp: ts,
      dateKey: dayKeyFromTimestamp(ts),
      lat: geo ? geo.lat : null,
      lon: geo ? geo.lon : null,
    },
  };
}

function snapshotFromState(input: {
  q: string;
  requireGeo: boolean;
  acceptedByPageId: Map<number, CommonsByDateItem>;
  apiRequests: number;
  truncated: boolean;
  rejectedSamples: RejectedCommonsFile[];
  rejectedTotal: number;
  geoSkippedCount: number;
  scannedCount: number;
}): CommonsSearchGroupedSnapshot {
  const items = [...input.acceptedByPageId.values()];
  const byDate = buildDateProximitySegments(items);
  return {
    query: input.q,
    requireGeo: input.requireGeo,
    groupCount: byDate.length,
    totalFetched: items.length,
    apiRequests: input.apiRequests,
    byDate,
    truncated: input.truncated,
    rejected: input.rejectedSamples,
    rejectedTotal: input.rejectedTotal,
    geoSkippedCount: input.geoSkippedCount,
    scannedCount: input.scannedCount,
  };
}

/**
 * Yields after each Commons API page so UIs can render incrementally (e.g. SSE).
 */
export async function* streamCommonsSearchGroupedByDate(input: {
  searchQuery: string;
  maxFiles: number;
  imagesOnly?: boolean;
  requireGeo?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<CommonsSearchGroupedSnapshot> {
  const q = input.searchQuery.trim();
  const maxFiles = Math.max(1, Math.min(2000, Math.floor(input.maxFiles)));
  const imagesOnly = input.imagesOnly !== false;
  const requireGeo = input.requireGeo ?? true;
  const acceptedByPageId = new Map<number, CommonsByDateItem>();
  const rejectedSamples: RejectedCommonsFile[] = [];
  let rejectedTotal = 0;
  let geoSkippedCount = 0;
  let scannedCount = 0;
  let apiRequests = 0;
  let cont: Record<string, string> = {};
  let truncated = false;
  let stoppedEarly = false;

  const pushReject = (row: RejectedCommonsFile) => {
    rejectedTotal += 1;
    if (rejectedSamples.length < MAX_REJECTED_SAMPLES) {
      rejectedSamples.push(row);
    }
  };

  while (acceptedByPageId.size < maxFiles) {
    if (input.signal?.aborted) break;
    if (apiRequests >= MAX_API_REQUESTS) {
      truncated = true;
      stoppedEarly = true;
      break;
    }
    const params: Record<string, string> = {
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: q,
      gsrnamespace: "6",
      gsrsort: "relevance",
      gsrlimit: "50",
      prop: "imageinfo|coordinates",
      iiprop: "url|timestamp|mime|size|extmetadata",
      iiurlwidth: "288",
      ...cont,
    };
    const data = await commonsGetJson(params, input.signal);
    apiRequests += 1;

    const pages = data.query?.pages ?? [];
    scannedCount += pages.length;

    for (const page of pages) {
      if (acceptedByPageId.size >= maxFiles) break;
      const out = processCommonsPage(page, imagesOnly, requireGeo);
      if (!out) continue;
      if (out.kind === "silent_geo") {
        geoSkippedCount += 1;
        continue;
      }
      if (out.kind === "reject") {
        pushReject(out.row);
        continue;
      }
      const id = typeof page.pageid === "number" ? page.pageid : 0;
      if (id) acceptedByPageId.set(id, out.item);
    }

    const hitCap = acceptedByPageId.size >= maxFiles;
    const more = Boolean(data.continue);
    truncated = hitCap && more;

    yield snapshotFromState({
      q,
      requireGeo,
      acceptedByPageId,
      apiRequests,
      truncated,
      rejectedSamples,
      rejectedTotal,
      geoSkippedCount,
      scannedCount,
    });

    if (!more) break;
    if (pages.length === 0) break;
    if (hitCap) break;

    cont = continueToParams(data.continue!);
  }

  if (stoppedEarly) {
    yield snapshotFromState({
      q,
      requireGeo,
      acceptedByPageId,
      apiRequests,
      truncated: true,
      rejectedSamples,
      rejectedTotal,
      geoSkippedCount,
      scannedCount,
    });
  }
}

export async function fetchCommonsSearchGroupedByDate(input: {
  searchQuery: string;
  maxFiles: number;
  imagesOnly?: boolean;
  requireGeo?: boolean;
  signal?: AbortSignal;
}): Promise<CommonsSearchGroupedSnapshot> {
  let last: CommonsSearchGroupedSnapshot | null = null;
  for await (const snap of streamCommonsSearchGroupedByDate(input)) {
    last = snap;
  }
  if (!last) {
    return snapshotFromState({
      q: input.searchQuery.trim(),
      requireGeo: input.requireGeo ?? true,
      acceptedByPageId: new Map(),
      apiRequests: 0,
      truncated: false,
      rejectedSamples: [],
      rejectedTotal: 0,
      geoSkippedCount: 0,
      scannedCount: 0,
    });
  }
  return last;
}

export type { RejectedCommonsFile } from "./commonsPhotoQualityGate.js";
