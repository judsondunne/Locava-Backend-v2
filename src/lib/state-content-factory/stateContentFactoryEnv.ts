import type { AppEnv } from "../../config/env.js";

export function stateContentFactoryDevPageEnabled(env: AppEnv): boolean {
  return String(env.ENABLE_STATE_CONTENT_FACTORY_DEV_PAGE ?? "").trim() === "true";
}

export function stateContentFactoryStagingWritesAllowed(env: AppEnv): boolean {
  return (
    String(env.STATE_CONTENT_FACTORY_ALLOW_STAGING_WRITES ?? "").trim() === "true" &&
    String(env.WIKIMEDIA_MVP_ALLOW_WRITES ?? "").trim() === "true"
  );
}
