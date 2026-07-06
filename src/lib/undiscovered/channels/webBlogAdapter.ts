import type { DiscoveryChannelAdapter, ChannelFetchContext, RawDiscoveryItem } from "./types.js";
import { itemsToChannelCandidates } from "./placeCandidateExtractor.js";

/**
 * Web / local-blog channel — extracts spot mentions from a page's text.
 *
 * Strategy: fetch a local outdoor blog or "best waterfalls in Vermont" listicle,
 * strip HTML to text, and pull place names. Given a URL it fetches live; it also
 * accepts pre-fetched `rawItems`. Region-gated so out-of-state listicles drop out.
 */

/**
 * Small HTML → text. Structural boundaries (links, list items, table cells,
 * headings, paragraphs, line breaks) become a hard `|` separator so the place
 * extractor can't run capitalized words across cells — otherwise a table of
 * park names flattens into garbage like "Aitken Arlington Black Turn Brook".
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(a|li|td|th|tr|p|h[1-6]|div|caption|figcaption|dt|dd)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/(?: ?\| ?)+/g, " | ")
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
