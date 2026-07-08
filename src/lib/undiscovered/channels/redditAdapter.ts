import type { DiscoveryChannelAdapter, ChannelFetchContext, RawDiscoveryItem } from "./types.js";
import { itemsToChannelCandidates } from "./placeCandidateExtractor.js";
import { fetchRedditSearchItems, hasRedditCreds } from "./redditClient.js";

/**
 * Reddit channel — searches a subreddit's public JSON for spot mentions.
 *
 * Strategy: query outdoorsy Vermont subreddits (r/vermont, r/VermontHiking) for
 * terms like "waterfall", "swimming hole", "hidden gem", extract place names
 * from post titles, and keep only Vermont-relevant results. Public JSON, no auth.
 */

const DEFAULT_SUBREDDITS = ["vermont", "VermontHiking"];

function buildSearchUrl(subreddit: string, query: string, limit: number): string {
  const q = encodeURIComponent(query);
  return `https://www.reddit.com/r/${subreddit}/search.json?q=${q}&restrict_sr=1&sort=relevance&limit=${limit}`;
}

function parseRedditListing(json: unknown): RawDiscoveryItem[] {
  const children = (json as { data?: { children?: Array<{ data?: Record<string, unknown> }> } })?.data
    ?.children;
  if (!Array.isArray(children)) return [];
  const items: RawDiscoveryItem[] = [];
  for (const c of children) {
    const d = c?.data;
    if (!d) continue;
    const id = String(d.id ?? "");
    const title = String(d.title ?? "");
    if (!id || !title) continue;
    const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : undefined;
    items.push({ sourceId: id, text: title, sourceUrl: permalink });
  }
  return items;
}

export const redditAdapter: DiscoveryChannelAdapter = {
  channel: "reddit",
  label: "Reddit",
  strategy:
    "Search r/vermont + r/VermontHiking for spot mentions in post titles (app-only OAuth; needs REDDIT_CLIENT_ID/SECRET).",
  liveFetchSupported: true,
  async fetchCandidates(ctx: ChannelFetchContext) {
    const query = ctx.query || "waterfall OR swimming hole OR hidden gem OR trail";
    const limit = Math.min(ctx.limit ?? 25, 100);
    let items = ctx.rawItems ?? [];

    if (items.length === 0) {
      if (hasRedditCreds(ctx.redditCreds)) {
        // Preferred path: authenticated OAuth search (Reddit blocks anonymous datacenter reads).
        items = await fetchRedditSearchItems({
          creds: ctx.redditCreds,
          subreddits: DEFAULT_SUBREDDITS,
          query,
          limit,
        });
      } else if (ctx.httpGetJson) {
        // Fallback: public JSON (often 403 from servers) — kept for local/testing.
        const perSub: RawDiscoveryItem[] = [];
        for (const sub of DEFAULT_SUBREDDITS) {
          try {
            perSub.push(...parseRedditListing(await ctx.httpGetJson(buildSearchUrl(sub, query, limit))));
          } catch {
            // Skip a failing subreddit.
          }
        }
        items = perSub;
      }
    }

    return itemsToChannelCandidates(items, {
      channel: "reddit",
      region: ctx.region,
      sourceProvider: "reddit-search",
    });
  },
};

export { parseRedditListing };
