import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "../../config/env.js";
import {
  resolveAnalyticsBigQueryClientInit,
  resolveAnalyticsBigQueryTableLocation
} from "./analytics-bigquery-credentials.js";

const sa = {
  type: "service_account",
  project_id: "p",
  private_key:
    "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\\n-----END PRIVATE KEY-----\\n",
  client_email: "bq-json-prefer@test.iam.gserviceaccount.com"
};

describe("resolveAnalyticsBigQueryTableLocation", () => {
  it("prefers ANALYTICS_BIGQUERY_PROJECT_ID over GCP_PROJECT_ID", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      ANALYTICS_BIGQUERY_PROJECT_ID: "bq-override",
      GCP_PROJECT_ID: "gcp-main",
      ANALYTICS_DATASET: "analytics_prod",
      ANALYTICS_EVENTS_TABLE: "client_events"
    });
    const loc = resolveAnalyticsBigQueryTableLocation(env, process.env);
    expect(loc.projectId).toBe("bq-override");
  });

});

describe("resolveAnalyticsBigQueryClientInit", () => {
  it("prefers ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_JSON over a key file path", () => {
    const tmp = path.join(os.tmpdir(), `locava-bq-gadc-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        ...sa,
        client_email: "bq-file-other@test.iam.gserviceaccount.com"
      }),
      "utf8"
    );
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      GCP_PROJECT_ID: "learn-32d72",
      ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_JSON: JSON.stringify(sa),
      GOOGLE_APPLICATION_CREDENTIALS: tmp
    });
    const init = resolveAnalyticsBigQueryClientInit(env, {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: tmp
    });
    expect(init.credentialSource).toBe("analytics_service_account_json");
    expect(init.serviceAccountEmail).toBe("bq-json-prefer@test.iam.gserviceaccount.com");
    fs.unlinkSync(tmp);
  });

  it("uses ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_FILE when JSON env is unset", () => {
    const tmp = path.join(os.tmpdir(), `locava-bq-file-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(sa), "utf8");
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      GCP_PROJECT_ID: "learn-32d72",
      ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_FILE: tmp
    });
    const init = resolveAnalyticsBigQueryClientInit(env, { ...process.env });
    expect(init.credentialSource).toBe("analytics_service_account_file");
    expect(init.serviceAccountEmail).toBe("bq-json-prefer@test.iam.gserviceaccount.com");
    expect(init.bigQueryOptions.keyFilename).toBeUndefined();
    expect(init.bigQueryOptions.credentials).toBeTruthy();
    fs.unlinkSync(tmp);
  });

  it("does not use Firebase Admin env keys when ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_FILE is set", () => {
    const tmp = path.join(os.tmpdir(), `locava-bq-file-firebase-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(sa), "utf8");
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      GCP_PROJECT_ID: "learn-32d72",
      FIREBASE_CLIENT_EMAIL: "firebase-admin@example.iam.gserviceaccount.com",
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nFAKE\\n-----END PRIVATE KEY-----\\n",
      ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_FILE: tmp
    });
    const init = resolveAnalyticsBigQueryClientInit(env, { ...process.env });
    expect(init.credentialSource).toBe("analytics_service_account_file");
    expect(init.serviceAccountEmail).toBe("bq-json-prefer@test.iam.gserviceaccount.com");
    expect(init.serviceAccountEmail).not.toContain("firebase-admin");
    fs.unlinkSync(tmp);
  });
});
