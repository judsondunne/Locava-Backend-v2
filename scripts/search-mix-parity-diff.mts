type JsonObject = Record<string, unknown>;

const BASE_URL = process.env.DEBUG_BASE_URL ?? "http://127.0.0.1:8080";
const VIEWER_ID = process.env.DEBUG_VIEWER_ID ?? "aXngoh9jeqW35FNM3fq1w9aXdEh1";

const headers = {
  "content-type": "application/json",
  "x-viewer-id": VIEWER_ID,
  "x-viewer-roles": "internal"
};

const QUERIES = ["hiking", "coffee", "sunset", "swimming", "waterfall", "trail near me"];

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function firstNTexts(rows: unknown[], n: number): string[] {
  return rows
    .map((row) => (row && typeof row === "object" ? normalizeText((row as JsonObject).text ?? (row as JsonObject).title) : ""))
    .filter(Boolean)
    .slice(0, n);
}

async function post(path: string, body: JsonObject): Promise<JsonObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: controller.signal
  });
  clearTimeout(timer);
  const payload = (await res.json()) as JsonObject;
  if (!res.ok) {
    throw new Error(`${path} failed (${res.status})`);
  }
  return payload;
}

async function get(path: string): Promise<JsonObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "x-viewer-id": VIEWER_ID, "x-viewer-roles": "internal" },
    signal: controller.signal
  });
  clearTimeout(timer);
  const payload = (await res.json()) as JsonObject;
  if (!res.ok) {
    throw new Error(`${path} failed (${res.status})`);
  }
  return payload;
}

async function run(): Promise<void> {
  const report: string[] = [];
  let mismatchCount = 0;

  report.push(`Search/Mix parity diff against ${BASE_URL}`);
  report.push(`viewerId=${VIEWER_ID}`);
  report.push("");

  for (const query of QUERIES) {
    const settled = await Promise.allSettled([
      post("/api/v1/product/search/suggest", { query }),
      get(`/v2/search/suggest?q=${encodeURIComponent(query)}`),
      post("/api/v1/product/search/live", { query, limit: 8 }),
      post("/v2/search/live", { query, limit: 8 })
    ]);
    if (settled.some((item) => item.status === "rejected")) {
      mismatchCount += 1;
      const reasons = settled
        .map((item, index) =>
          item.status === "rejected" ? `call${index + 1}:${item.reason instanceof Error ? item.reason.message : String(item.reason)}` : null
        )
        .filter(Boolean);
      report.push(`[MISMATCH] query="${query}" request failure ${reasons.join(" | ")}`);
      continue;
    }
    const [legacySuggest, v2Suggest, legacyLive, v2Live] = settled.map((item) => (item as PromiseFulfilledResult<JsonObject>).value);

    const legacySuggestRows = Array.isArray(legacySuggest.suggestions) ? legacySuggest.suggestions : [];
    const v2SuggestRows = Array.isArray((v2Suggest.data as JsonObject | undefined)?.suggestions)
      ? (((v2Suggest.data as JsonObject).suggestions as unknown[]) ?? [])
      : [];
    const legacyLivePosts = Array.isArray(legacyLive.posts) ? legacyLive.posts : [];
    const v2LivePosts = Array.isArray((v2Live.data as JsonObject | undefined)?.posts)
      ? (((v2Live.data as JsonObject).posts as unknown[]) ?? [])
      : [];

    const legacyTopSuggest = firstNTexts(legacySuggestRows, 3);
    const v2TopSuggest = firstNTexts(v2SuggestRows, 3);
    const legacyTopPosts = firstNTexts(legacyLivePosts, 5);
    const v2TopPosts = firstNTexts(v2LivePosts, 5);

    const suggestDiff = JSON.stringify(legacyTopSuggest) !== JSON.stringify(v2TopSuggest);
    const postDiff = JSON.stringify(legacyTopPosts) !== JSON.stringify(v2TopPosts);

    if (suggestDiff || postDiff) {
      mismatchCount += 1;
      report.push(`[MISMATCH] query="${query}"`);
      if (suggestDiff) report.push(`  suggest legacy=${JSON.stringify(legacyTopSuggest)} v2=${JSON.stringify(v2TopSuggest)}`);
      if (postDiff) report.push(`  posts   legacy=${JSON.stringify(legacyTopPosts)} v2=${JSON.stringify(v2TopPosts)}`);
    } else {
      report.push(`[MATCH] query="${query}" suggest+live top ordering aligned`);
    }
  }

  const [legacyPrewarm, v2Prewarm] = await Promise.all([
    post("/api/v1/product/mixes/prewarm", {}),
    post("/v2/mixes/prewarm", {})
  ]);
  const legacyMixIds = (Array.isArray(legacyPrewarm.mixSpecs) ? legacyPrewarm.mixSpecs : [])
    .map((mix) => (mix && typeof mix === "object" ? String((mix as JsonObject).id ?? "") : ""))
    .filter(Boolean)
    .slice(0, 6);
  const v2MixIds = (Array.isArray((v2Prewarm.data as JsonObject | undefined)?.mixSpecs)
    ? (((v2Prewarm.data as JsonObject).mixSpecs as unknown[]) ?? [])
    : []
  )
    .map((mix) => (mix && typeof mix === "object" ? String((mix as JsonObject).id ?? "") : ""))
    .filter(Boolean)
    .slice(0, 6);

  if (JSON.stringify(legacyMixIds) !== JSON.stringify(v2MixIds)) {
    mismatchCount += 1;
    report.push(`[MISMATCH] mixes/prewarm ids legacy=${JSON.stringify(legacyMixIds)} v2=${JSON.stringify(v2MixIds)}`);
  } else {
    report.push(`[MATCH] mixes/prewarm top ids aligned`);
  }

  report.push("");
  report.push(mismatchCount === 0 ? "RESULT: parity diff clean for tested search/mix queries" : `RESULT: ${mismatchCount} mismatches detected`);
  console.log(report.join("\n"));
  if (mismatchCount > 0) process.exitCode = 1;
}

await run();
