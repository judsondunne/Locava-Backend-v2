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

/** Curated real Vermont pages used when no URL is supplied, so Scrape works one-click. */
export const DEFAULT_VERMONT_WEB_SOURCES = [
  "https://en.wikipedia.org/wiki/List_of_Vermont_state_parks",
  "https://en.wikipedia.org/wiki/Camel%27s_Hump",
  "https://en.wikipedia.org/wiki/Green_Mountains",
];

export const webBlogAdapter: DiscoveryChannelAdapter = {
  channel: "web_blog",
  label: "Web / local blog",
  strategy: "Fetch outdoor blogs / listicles (or default Vermont pages), strip to text, extract named spots.",
  liveFetchSupported: true,
  async fetchCandidates(ctx: ChannelFetchContext) {
    let items = ctx.rawItems ?? [];
    if (items.length === 0 && ctx.httpGetText) {
      // Accept one URL, a comma-separated list, or fall back to curated Vermont pages.
      const urls = (ctx.query ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//i.test(s));
      const targets = urls.length > 0 ? urls : DEFAULT_VERMONT_WEB_SOURCES;
      const fetched: RawDiscoveryItem[] = [];
      for (const url of targets) {
        try {
          const html = await ctx.httpGetText(url);
          fetched.push({ sourceId: url, text: htmlToText(html), sourceUrl: url });
        } catch {
          // Skip an unreachable page; others still contribute.
        }
      }
      items = fetched;
    }
    return itemsToChannelCandidates(items, {
      channel: "web_blog",
      region: ctx.region,
      sourceProvider: "web-blog",
    });
  },
};
