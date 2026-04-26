import process from "node:process";

type BootstrapPost = { postId?: string; id?: string; title?: string };
type BootstrapResponse = {
  success?: boolean;
  posts?: BootstrapPost[];
  parsedSummary?: { activity?: string | null; nearMe?: boolean; genericDiscovery?: boolean };
};

const OLD_BASE = process.env.OLD_SEARCH_BASE_URL ?? "https://locava-backend-nboawyiasq-uc.a.run.app";
const NEW_BASE = process.env.NEW_SEARCH_BASE_URL ?? "http://127.0.0.1:8080";

const QUERIES = [
  "hiking near me",
  "best hikes in vermont",
  "waterfalls near me",
  "sunset spots",
  "coffee near me",
  "things to do in boston",
  "swimming in vermont",
  "best brunch",
  "new york",
  "fun hikes",
];

async function postBootstrap(base: string, query: string): Promise<BootstrapResponse> {
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/v1/product/search/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      limit: 24,
      userContext: { lat: 42.33, lng: -71.11 }
    })
  });
  return (await res.json()) as BootstrapResponse;
}

function normalizePosts(posts: BootstrapPost[] = []): string[] {
  return posts
    .map((p) => `${String(p.postId ?? p.id ?? "")}:${String(p.title ?? "").trim().toLowerCase()}`)
    .filter((row) => !row.startsWith(":"));
}

async function main(): Promise<void> {
  let mismatches = 0;
  for (const query of QUERIES) {
    const [oldRes, newRes] = await Promise.all([postBootstrap(OLD_BASE, query), postBootstrap(NEW_BASE, query)]);
    const oldRows = normalizePosts(oldRes.posts);
    const newRows = normalizePosts(newRes.posts);
    const oldTop = oldRows[0] ?? "";
    const newTop = newRows[0] ?? "";
    const oldTop5 = new Set(oldRows.slice(0, 5));
    const newTop5 = new Set(newRows.slice(0, 5));
    const overlapTop5 = [...oldTop5].filter((x) => newTop5.has(x)).length;
    const pass = oldTop === newTop || overlapTop5 >= 3;
    if (!pass) mismatches += 1;
    console.log(JSON.stringify({
      query,
      pass,
      oldCount: oldRows.length,
      newCount: newRows.length,
      oldTop,
      newTop,
      overlapTop5,
      oldActivity: oldRes.parsedSummary?.activity ?? null,
      newActivity: newRes.parsedSummary?.activity ?? null
    }));
  }
  console.log(`BOOTSTRAP_PARITY_SUMMARY mismatches=${mismatches} total=${QUERIES.length}`);
  if (mismatches > 0) process.exitCode = 2;
}

await main();
