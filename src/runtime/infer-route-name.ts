/**
 * Best-effort routeName before handlers run setRouteName(), used for priority gating + policy lookup.
 */

type Entry = { method: string; path: string; routeName: string };

/** Longer paths first so /v2/foo/bar wins over /v2/foo */
const ROUTE_INDEX: Entry[] = [
  { method: "GET", path: "/v2/feed/for-you/simple", routeName: "feed.for_you_simple.get" },
  { method: "GET", path: "/v2/legends/events/unseen", routeName: "legends.events.unseen.get" },
  { method: "GET", path: "/v2/achievements/bootstrap", routeName: "achievements.bootstrap.get" },
  { method: "GET", path: "/v2/achievements/leagues", routeName: "achievements.leagues.get" },
  { method: "POST", path: "/v2/achievements/screen-opened", routeName: "achievements.screenopened.post" },
  { method: "POST", path: "/v2/analytics/events", routeName: "analytics.events.post" },
  { method: "GET", path: "/v2/search/home-bootstrap", routeName: "search.home_bootstrap.v1" },
  { method: "GET", path: "/v2/auth/session", routeName: "auth.session.get" },
  { method: "GET", path: "/v2/map/markers", routeName: "map.markers.get" },
  { method: "GET", path: "/v2/map/bootstrap", routeName: "map.bootstrap.get" },
  { method: "POST", path: "/v2/posts/details:batch", routeName: "posts.detail.batch" },
  { method: "GET", path: "/api/v1/product/reels/near-me/count", routeName: "compat.reels.near_me_count" },
  { method: "GET", path: "/api/v1/product/reels/near-me", routeName: "compat.reels.near_me" }
].sort((a, b) => b.path.length - a.path.length);

export function inferRouteNameFromRequest(method: string, rawUrl: string): string | undefined {
  let pathname = rawUrl;
  try {
    const u = new URL(rawUrl, "http://127.0.0.1");
    pathname = u.pathname;
  } catch {
    const q = rawUrl.indexOf("?");
    pathname = q >= 0 ? rawUrl.slice(0, q) : rawUrl;
  }
  const m = method.toUpperCase();
  if (m === "POST" && /\/v2\/legends\/events\/[^/]+\/seen$/.test(pathname)) {
    return "legends.events.seen.post";
  }
  if (m === "GET" && pathname.startsWith("/v2/achievements/leaderboard/")) {
    return "achievements.leaderboard.get";
  }
  for (const row of ROUTE_INDEX) {
    if (row.method !== m) continue;
    if (pathname === row.path || pathname.startsWith(`${row.path}/`)) {
      return row.routeName;
    }
  }
  return undefined;
}
