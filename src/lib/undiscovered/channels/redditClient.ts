import type { RawDiscoveryItem } from "./types.js";

/**
 * Reddit app-only OAuth ("client_credentials") + search.
 *
 * Reddit blocks unauthenticated datacenter requests (HTTP 403), so live search
 * needs a registered "script" app. This does the app-only token exchange (no
 * user account required) and queries the OAuth search endpoint. Credentials come
 * from env (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET); this code never logs them.
 */

export interface RedditCreds {
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
}

export function hasRedditCreds(c: RedditCreds | undefined): c is Required<Pick<RedditCreds, "clientId" | "clientSecret">> & RedditCreds {
  return !!(c && c.clientId && c.clientSecret);
}

type FetchLike = typeof fetch;

let tokenCache: { token: string; expiresAt: number } | null = null;

/** Parse the token response body; exported for tests. */
export function parseTokenResponse(json: unknown): { token: string; expiresIn: number } | null {
  const j = json as { access_token?: string; expires_in?: number };
  if (!j || typeof j.access_token !== "string") return null;
  return { token: j.access_token, expiresIn: typeof j.expires_in === "number" ? j.expires_in : 3600 };
}

export async function getRedditAppToken(
  creds: RedditCreds,
  fetchImpl: FetchLike = fetch,
  now: number = Date.now(),
): Promise<string | null> {
  if (!hasRedditCreds(creds)) return null;
  if (tokenCache && tokenCache.expiresAt > now + 30_000) return tokenCache.token;

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetchImpl("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": creds.userAgent || "locava-undiscovered/1.0",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`reddit_auth_failed:${res.status}`);
  const parsed = parseTokenResponse(await res.json());
  if (!parsed) throw new Error("reddit_auth_no_token");
  tokenCache = { token: parsed.token, expiresAt: now + parsed.expiresIn * 1000 };
  return parsed.token;
}

/** Clear the cached token (tests / forced refresh). */
export function resetRedditTokenCache(): void {
  tokenCache = null;
}

/** Parse a Reddit search listing into raw items; exported for tests. */
export function parseSearchListing(json: unknown): RawDiscoveryItem[] {
  const children = (json as { data?: { children?: Array<{ data?: Record<string, unknown> }> } })?.data?.children;
  if (!Array.isArray(children)) return [];
  const out: RawDiscoveryItem[] = [];
  for (const c of children) {
    const d = c?.data;
    if (!d) continue;
    const id = String(d.id ?? "");
    const title = String(d.title ?? "");
    if (!id || !title) continue;
    out.push({
      sourceId: id,
      text: title,
      sourceUrl: d.permalink ? `https://www.reddit.com${d.permalink}` : undefined,
    });
  }
  return out;
}

/**
 * Authenticated search across subreddits. Returns [] (never throws for a single
 * failing subreddit) so one bad sub doesn't sink the run.
 */
export async function fetchRedditSearchItems(opts: {
  creds: RedditCreds;
  subreddits: string[];
  query: string;
  limit: number;
  fetchImpl?: FetchLike;
}): Promise<RawDiscoveryItem[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = await getRedditAppToken(opts.creds, fetchImpl);
  if (!token) return [];
  const ua = opts.creds.userAgent || "locava-undiscovered/1.0";
  const items: RawDiscoveryItem[] = [];
  for (const sub of opts.subreddits) {
    const url =
      `https://oauth.reddit.com/r/${sub}/search?` +
      `q=${encodeURIComponent(opts.query)}&restrict_sr=1&sort=relevance&limit=${opts.limit}`;
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": ua },
      });
      if (!res.ok) continue;
      items.push(...parseSearchListing(await res.json()));
    } catch {
      // Skip a failing subreddit.
    }
  }
  return items;
}
