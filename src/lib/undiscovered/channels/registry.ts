import type { DiscoveryChannelAdapter } from "./types.js";
import type { DiscoverySourceChannel } from "../../../contracts/surfaces/undiscovered-candidate.contract.js";
import { redditAdapter } from "./redditAdapter.js";
import { webBlogAdapter } from "./webBlogAdapter.js";
import { trailAdapter } from "./trailAdapter.js";
import { instagramAdapter } from "./instagramAdapter.js";

/** All non-OSM discovery channel adapters, keyed by channel. */
const ADAPTERS: DiscoveryChannelAdapter[] = [
  redditAdapter,
  trailAdapter,
  webBlogAdapter,
  instagramAdapter,
];

const BY_CHANNEL = new Map<DiscoverySourceChannel, DiscoveryChannelAdapter>(
  ADAPTERS.map((a) => [a.channel, a]),
);

export function listChannelAdapters(): DiscoveryChannelAdapter[] {
  return ADAPTERS;
}

export function getChannelAdapter(channel: string): DiscoveryChannelAdapter | undefined {
  return BY_CHANNEL.get(channel as DiscoverySourceChannel);
}

/** Default fetchers using global fetch (Node 18+). Adapters accept these via context. */
export const defaultHttpFetchers = {
  httpGetJson: async (url: string): Promise<unknown> => {
    const res = await fetch(url, { headers: { "user-agent": "locava-undiscovered/1.0" } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.json();
  },
  httpGetText: async (url: string): Promise<string> => {
    const res = await fetch(url, { headers: { "user-agent": "locava-undiscovered/1.0" } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res.text();
  },
};
