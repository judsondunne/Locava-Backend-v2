import "dotenv/config";
import { BigQuery } from "@google-cloud/bigquery";
import { loadEnv } from "../src/config/env.js";
import { getAnalyticsBigQueryRuntimeConfig } from "../src/repositories/analytics/analytics-publisher.js";

type CheckResult =
  | "PASS"
  | "FAIL_MISSING_DATASET"
  | "FAIL_MISSING_TABLE"
  | "FAIL_PERMISSION_DENIED"
  | "FAIL_CONFIG_MISMATCH"
  | "UNKNOWN_ERROR";

function isPermissionError(message: string): boolean {
  return /permission|access denied|denied/i.test(message);
}

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const runtime = getAnalyticsBigQueryRuntimeConfig(env);
  const testWrite = process.env.ANALYTICS_BIGQUERY_TEST_WRITE === "1";

  console.log(
    JSON.stringify({
      event: "analytics_bigquery_identity",
      enabled: runtime.enabled,
      projectId: runtime.projectId,
      dataset: runtime.dataset,
      table: runtime.table,
      credentialSource: runtime.credentialSource,
      serviceAccountEmail: runtime.serviceAccountEmail,
      nonBlockingFailures: runtime.nonBlockingFailures,
      testWriteEnabled: testWrite,
    })
  );

  if (!runtime.enabled || !runtime.projectId || !runtime.dataset || !runtime.table) {
    console.log(
      JSON.stringify({
        result: "FAIL_CONFIG_MISMATCH" satisfies CheckResult,
        detail: "Analytics BigQuery runtime config is incomplete or disabled by env.",
      })
    );
    process.exitCode = 1;
    return;
  }

  const bigQuery = new BigQuery({ projectId: runtime.projectId });
  const dataset = bigQuery.dataset(runtime.dataset);
  const table = dataset.table(runtime.table);

  try {
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      console.log(
        JSON.stringify({
          result: "FAIL_MISSING_DATASET" satisfies CheckResult,
          detail: `Dataset ${runtime.projectId}:${runtime.dataset} does not exist.`,
        })
      );
      process.exitCode = 1;
      return;
    }

    const [tableExists] = await table.exists();
    if (!tableExists) {
      console.log(
        JSON.stringify({
          result: "FAIL_MISSING_TABLE" satisfies CheckResult,
          detail: `Table ${runtime.projectId}:${runtime.dataset}.${runtime.table} does not exist.`,
        })
      );
      process.exitCode = 1;
      return;
    }

    if (!testWrite) {
      console.log(
        JSON.stringify({
          result: "PASS" satisfies CheckResult,
          detail: "Dataset/table metadata checks passed. Skipped write test (set ANALYTICS_BIGQUERY_TEST_WRITE=1 to enable).",
        })
      );
      return;
    }

    const probeId = `analytics-check-${Date.now()}`;
    await table.insert([
      {
        event: "diagnostic_probe",
        schemaVersion: "1.0.0",
        userId: null,
        anonId: probeId,
        sessionId: probeId,
        clientTime: new Date(),
        receivedAt: new Date(),
        platform: "backend",
        requestIp: null,
        userAgent: "check-bigquery-analytics-access",
        properties: JSON.stringify({ probeId, source: "check-bigquery-analytics-access" }),
      },
    ]);
    console.log(
      JSON.stringify({
        result: "PASS" satisfies CheckResult,
        detail: "Metadata checks passed and test write succeeded.",
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const result: CheckResult = isPermissionError(message) ? "FAIL_PERMISSION_DENIED" : "UNKNOWN_ERROR";
    console.log(
      JSON.stringify({
        result,
        detail: message,
      })
    );
    process.exitCode = 1;
  }
}

await main();
