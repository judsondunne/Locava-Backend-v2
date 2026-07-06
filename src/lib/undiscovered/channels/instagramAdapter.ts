import type { DiscoveryChannelAdapter, ChannelFetchContext } from "./types.js";
import { itemsToChannelCandidates } from "./placeCandidateExtractor.js";

/**
 * Instagram channel — started, extraction-ready but not live-fetching.
 *
 * Strategy: Instagram has no open search API; live pulls require the Graph API
 * (business accounts) or an approved provider. The extraction path is identical
 * to the other text channels — caption text + a location tag → candidate. So this
 * adapter runs today on `rawItems` (captions + optional geotag from a location
 * search or manual paste) and is wired to accept a live fetcher later without
 * changing the dashboard. `liveFetchSupported` is false until that source lands.
 */
export const instagramAdapter: DiscoveryChannelAdapter = {
  channel: "instagram",
  label: "Instagram",
  strategy:
    "Extract spots from captions + geotags (rawItems today; Graph API / provider fetch is the follow-up).",
  liveFetchSupported: false,
  async fetchCandidates(ctx: ChannelFetchContext) {
    const items = ctx.rawItems ?? [];
    return itemsToChannelCandidates(items, {
      channel: "instagram",
      region: ctx.region,
      sourceProvider: "instagram",
    });
  },
};
