// @ts-nocheck
function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeUrl(raw) {
  const value = String(raw || "").trim();
  return /^https?:\/\//i.test(value) ? value : "";
}

function inferExt(candidate, url) {
  const ext = String(candidate?.ext || "").trim().toLowerCase();
  if (ext) return ext;
  try {
    const path = new URL(url).pathname.toLowerCase();
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function inferProtocol(candidate, url) {
  const protocol = String(candidate?.protocol || "").trim().toLowerCase();
  if (protocol) return protocol;
  return /\.m3u8(\?|$)/i.test(url) ? "m3u8" : "https";
}

function inferHasAudio(candidate) {
  if (candidate?.hasAudio === true) return true;
  if (candidate?.hasAudio === false) return false;
  const acodec = String(candidate?.acodec || "").trim().toLowerCase();
  if (!acodec) return null;
  return acodec !== "none";
}

function inferHeight(candidate) {
  return (
    toFiniteNumber(candidate?.height) ||
    toFiniteNumber(candidate?.resolutionHeight) ||
    toFiniteNumber(candidate?.dimensions?.height)
  );
}

function inferWidth(candidate) {
  return (
    toFiniteNumber(candidate?.width) ||
    toFiniteNumber(candidate?.resolutionWidth) ||
    toFiniteNumber(candidate?.dimensions?.width)
  );
}

function inferBitrate(candidate) {
  return (
    toFiniteNumber(candidate?.bitrate) ||
    toFiniteNumber(candidate?.tbr) ||
    toFiniteNumber(candidate?.vbr) ||
    toFiniteNumber(candidate?.bandwidth)
  );
}

function inferFilesize(candidate) {
  return (
    toFiniteNumber(candidate?.filesize) ||
    toFiniteNumber(candidate?.filesize_approx) ||
    toFiniteNumber(candidate?.contentLength) ||
    toFiniteNumber(candidate?.content_length)
  );
}

function buildCandidateShape(raw, index) {
  const url = normalizeUrl(raw?.url);
  if (!url) return null;
  const normalizedIndex = Number.isFinite(Number(raw?.index)) ? Number(raw.index) : index;
  const protocol = inferProtocol(raw, url);
  const ext = inferExt(raw, url);
  const hasAudio = inferHasAudio(raw);
  const isManifest =
    protocol.includes("m3u8") ||
    protocol.includes("dash") ||
    protocol.includes("m3u") ||
    protocol.includes("ism") ||
    /\.m3u8(\?|$)/i.test(url);
  const isDirectFile = /\.(mp4|mov|m4v)(\?|$)/i.test(url) || ["mp4", "mov", "m4v"].includes(ext);
  return {
    raw,
    index: normalizedIndex,
    url,
    width: inferWidth(raw),
    height: inferHeight(raw),
    bitrate: inferBitrate(raw),
    filesize: inferFilesize(raw),
    hasAudio,
    protocol,
    ext,
    isManifest,
    isDirectFile,
  };
}

function compareDesc(a, b) {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function compareTruthy(a, b) {
  return compareDesc(Boolean(a) ? 1 : 0, Boolean(b) ? 1 : 0);
}

function compareNullableBool(a, b) {
  const score = (value) => (value === true ? 2 : value === false ? 1 : 0);
  return compareDesc(score(a), score(b));
}

/**
 * Prefer higher resolution / bitrate first. Only after that prefer direct progressive
 * files over manifests (HLS/DASH), so we do not pick a tiny MP4 just because it is "direct"
 * when a higher-quality progressive URL exists.
 *
 * When at least one candidate is a direct non-manifest URL, we restrict to those so
 * `/api/instagram-reel/file` always receives a normal MP4 URL (not an m3u8 playlist).
 */
function compareQualityFirst(left, right) {
  const comparisons = [
    compareNullableBool(left.hasAudio, right.hasAudio),
    compareDesc(left.height, right.height),
    compareDesc(left.width, right.width),
    compareDesc(left.bitrate, right.bitrate),
    compareDesc(left.filesize, right.filesize),
    compareTruthy(left.isDirectFile, right.isDirectFile),
    compareTruthy(!left.isManifest, !right.isManifest),
    compareDesc(left.url.length, right.url.length),
    compareDesc(-left.index, -right.index),
  ];
  return comparisons.find((result) => result !== 0) || 0;
}

export function compareInstagramVideoCandidates(leftRaw, rightRaw) {
  const left = buildCandidateShape(leftRaw, 0);
  const right = buildCandidateShape(rightRaw, 1);
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return compareQualityFirst(left, right);
}

export function pickBestInstagramVideoCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const shaped = [];
  list.forEach((candidate, index) => {
    const current = buildCandidateShape(candidate, index);
    if (current) shaped.push(current);
  });
  if (!shaped.length) return null;

  const progressive = shaped.filter((c) => c.isDirectFile && !c.isManifest);
  const pool = progressive.length ? progressive : shaped;

  let best = null;
  for (const current of pool) {
    if (!best || compareQualityFirst(current, best) < 0) {
      best = current;
    }
  }
  return best;
}

export function pickBestInstagramVideoUrl(candidates) {
  return pickBestInstagramVideoCandidate(candidates)?.url || null;
}
