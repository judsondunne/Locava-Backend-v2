const env = process.env;

const debugEnabled = env.ENABLE_DEBUG_LOGS === "true";

export const LOG_AUTH_DEBUG = debugEnabled && env.LOG_AUTH_DEBUG === "1";
export const LOG_FEED_DEBUG = debugEnabled && env.LOG_FEED_DEBUG === "1";
export const LOG_MEDIA_DEBUG = debugEnabled && env.LOG_MEDIA_DEBUG === "1";
export const LOG_VIDEO_DEBUG = debugEnabled && env.LOG_VIDEO_DEBUG === "1";
export const LOG_POST_DEBUG = debugEnabled && env.LOG_POST_DEBUG === "1";
export const LOG_SOCIAL_DEBUG = debugEnabled && env.LOG_SOCIAL_DEBUG === "1";
export const LOG_STARTUP_DEBUG = debugEnabled && env.LOG_STARTUP_DEBUG === "1";
export const LOG_ANALYTICS_DEBUG = debugEnabled && env.LOG_ANALYTICS_DEBUG === "1";
export const LOG_SEARCH_DEBUG = debugEnabled && env.LOG_SEARCH_DEBUG === "1";
export const LOG_REQUEST_DEBUG = debugEnabled && env.LOG_REQUEST_DEBUG === "1";

export function isDebugScopeEnabled(scope: string): boolean {
  switch (scope) {
    case "auth":
      return LOG_AUTH_DEBUG;
    case "feed":
      return LOG_FEED_DEBUG;
    case "media":
      return LOG_MEDIA_DEBUG;
    case "video":
      return LOG_VIDEO_DEBUG;
    case "post":
      return LOG_POST_DEBUG;
    case "social":
      return LOG_SOCIAL_DEBUG;
    case "startup":
      return LOG_STARTUP_DEBUG;
    case "analytics":
      return LOG_ANALYTICS_DEBUG;
    case "search":
      return LOG_SEARCH_DEBUG;
    case "request":
      return LOG_REQUEST_DEBUG;
    default:
      return debugEnabled;
  }
}
