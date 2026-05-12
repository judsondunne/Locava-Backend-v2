import { loadEnv } from "../../src/config/env.js";
import { stateContentFactoryStagingWritesAllowed } from "../../src/lib/state-content-factory/stateContentFactoryEnv.js";

const env = loadEnv();
if (!stateContentFactoryStagingWritesAllowed(env)) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "staging_writes_refused",
      required: ["STATE_CONTENT_FACTORY_ALLOW_STAGING_WRITES=true", "WIKIMEDIA_MVP_ALLOW_WRITES=true"],
    }),
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    message: "staging write guards satisfied; use dashboard stage_only with allowStagingWrites=true",
  }),
);
