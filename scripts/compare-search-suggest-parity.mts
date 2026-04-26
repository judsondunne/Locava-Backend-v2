import process from "node:process";

type SuggestRow = { text?: string; type?: string; suggestionType?: string };
type SuggestResponse = {
  success?: boolean;
  suggestions?: SuggestRow[];
  detectedActivity?: string | null;
  relatedActivities?: string[];
};

const OLD_BASE = process.env.OLD_SEARCH_BASE_URL ?? "https://locava-backend-nboawyiasq-uc.a.run.app";
const NEW_BASE = process.env.NEW_SEARCH_BASE_URL ?? "http://127.0.0.1:8080";

const QUERIES = [
  "h","hi","hik","hiki","hiking","hiking i","hiking in","hiking in v","hiking near",
  "best","best h","best hik","best hiking","best hikes","best hikes in","best hikes in v",
  "fun","fun h","sun","sunset","water","waterf","waterfall","swim","swimming",
  "ver","verm","vermont","new","new y","new york","coffee","coff","caf","brun","brunch",
  "things","things to do","things to do in","things to do in b"
];

async function postSuggest(base: string, query: string): Promise<SuggestResponse> {
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/v1/product/search/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, mode: "social", userContext: { lat: 42.33, lng: -71.11 } })
  });
  return (await res.json()) as SuggestResponse;
}

function normalizeRows(rows: SuggestRow[] = []): string[] {
  return rows
    .map((row) => `${String(row.type ?? "")}:${String(row.suggestionType ?? "")}:${String(row.text ?? "").trim().toLowerCase()}`)
    .filter(Boolean);
}

async function main(): Promise<void> {
  let mismatches = 0;
  for (const query of QUERIES) {
    const [oldRes, newRes] = await Promise.all([postSuggest(OLD_BASE, query), postSuggest(NEW_BASE, query)]);
    const oldRows = normalizeRows(oldRes.suggestions);
    const newRows = normalizeRows(newRes.suggestions);
    const oldTop = oldRows[0] ?? "";
    const newTop = newRows[0] ?? "";
    const sameTop = oldTop === newTop;
    const oldSet = new Set(oldRows);
    const newSet = new Set(newRows);
    const missing = oldRows.filter((row) => !newSet.has(row)).slice(0, 3);
    const extras = newRows.filter((row) => !oldSet.has(row)).slice(0, 3);
    const pass = sameTop && missing.length === 0 && extras.length === 0;
    if (!pass) mismatches += 1;
    console.log(JSON.stringify({
      query,
      pass,
      oldCount: oldRows.length,
      newCount: newRows.length,
      oldTop,
      newTop,
      missing,
      extras
    }));
  }
  console.log(`PARITY_SUMMARY mismatches=${mismatches} total=${QUERIES.length}`);
  if (mismatches > 0) process.exitCode = 2;
}

await main();
