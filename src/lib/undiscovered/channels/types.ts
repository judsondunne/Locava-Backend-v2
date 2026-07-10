import type {
  DiscoveryCandidate,
  DiscoverySourceChannel,
} from "../../../contracts/surfaces/undiscovered-candidate.contract.js";

/**
 * Multi-channel discovery adapters (June 26–27).
 *
 * Every non-OSM source (Reddit, Instagram, web/blog, trail DBs) implements the
 * same tiny interface and emits the same `DiscoveryCandidate`, so they all flow
 * into the existing review queue, dashboard, and quality gate — no dashboard
 * changes required per channel.
 */

/** A raw item pulled from a source before place extraction. */
export interface RawDiscoveryItem {
  /** Stable id within the source (post id, url hash, etc.). */
  sourceId: string;
  /** Free text to extract place names from (title, caption, paragraph). */
  text: string;
  sourceUrl?: string;
  lat?: number;
  lng?: number;
  extra?: Record<string, unknown>;
}

/**
 * Context passed to an adapter. `httpGetJson`/`httpGetText` are injectable so
 * adapters are unit-testable and never hit the network in tests. `rawItems`
 * lets a caller feed fixtures or already-fetched items directly.
 */
export interface ChannelFetchContext {
  region: string;
  query?: string;
  limit?: number;
  rawItems?: RawDiscoveryItem[];
  httpGetJson?: (url: string) => Promise<unknown>;
  httpGetText?: (url: string) => Promise<string>;
  /** Reddit app-only OAuth credentials, supplied by the route from env when present. */
  redditCreds?: { clientId?: string; clientSecret?: string; userAgent?: string };
}

export interface DiscoveryChannelAdapter {
  channel: DiscoverySourceChannel;
  label: string;
  /** Short description of the strategy for this channel (shown in the dashboard). */
  strategy: string;
  /** True when the adapter can fetch live with only the built-in fetchers (no extra auth). */
  liveFetchSupported: boolean;
  fetchCandidates(ctx: ChannelFetchContext): Promise<DiscoveryCandidate[]>;
}
