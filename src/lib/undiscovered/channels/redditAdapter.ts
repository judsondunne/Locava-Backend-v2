import type { DiscoveryChannelAdapter, ChannelFetchContext, RawDiscoveryItem } from "./types.js";
import { itemsToChannelCandidates } from "./placeCandidateExtractor.js";

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
  strategy: "Search r/vermont + r/VermontHiking public JSON for spot mentions in post titles.",
  liveFetchSupported: true,
  async fetchCandidates(ctx: ChannelFetchContext) {
    let items = ctx.rawItems ?? [];
    if (items.length === 0 && ctx.httpGetJson) {
      const query = ctx.query || "waterfall OR swimming hole OR hidden gem OR trail";
      const limit = Math.min(ctx.limit ?? 25, 100);
      const perSub: RawDiscoveryItem[] = [];
      for (const sub of DEFAULT_SUBREDDITS) {
        try {
          const json = await ctx.httpGetJson(buildSearchUrl(sub, query, limit));
          perSub.push(...parseRedditListing(json));
        } catch {
          // Skip a failing subreddit; other channels/subs still contribute.
        }
      }
      items = perSub;
    }
    return itemsToChannelCandidates(items, {
      channel: "reddit",
      region: ctx.region,
      sourceProvider: "reddit-search",
    });
  },
};

export { parseRedditListing };
