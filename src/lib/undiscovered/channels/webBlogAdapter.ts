import type { DiscoveryChannelAdapter, ChannelFetchContext, RawDiscoveryItem } from "./types.js";
import { itemsToChannelCandidates } from "./placeCandidateExtractor.js";

/**
 * Web / local-blog channel — extracts spot mentions from a page's text.
 *
 * Strategy: fetch a local outdoor blog or "best waterfalls in Vermont" listicle,
 * strip HTML to text, and pull place names. Given a URL it fetches live; it also
 * accepts pre-fetched `rawItems`. Region-gated so out-of-state listicles drop out.
 */

/** Very small HTML → text: drop scripts/styles/tags, collapse whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export const webBlogAdapter: DiscoveryChannelAdapter = {
  channel: "web_blog",
  label: "Web / local blog",
  strategy: "Fetch outdoor blogs / listicles, strip to text, extract named spots.",
  liveFetchSupported: true,
  async fetchCandidates(ctx: ChannelFetchContext) {
    let items = ctx.rawItems ?? [];
    if (items.length === 0 && ctx.query && ctx.httpGetText) {
      try {
        const html = await ctx.httpGetText(ctx.query);
        const text = htmlToText(html);
        items = [{ sourceId: ctx.query, text, sourceUrl: ctx.query }] as RawDiscoveryItem[];
      } catch {
        items = [];
      }
    }
    return itemsToChannelCandidates(items, {
      channel: "web_blog",
      region: ctx.region,
      sourceProvider: "web-blog",
    });
  },
};
