import "dotenv/config";
import { BigQuery } from "@google-cloud/bigquery";
import { loadEnv } from "../src/config/env.js";
import {
  extractMissingBigQueryPermission,
  getAnalyticsBigQueryRuntimeConfig
} from "../src/repositories/analytics/analytics-publisher.js";
import { resolveAnalyticsBigQueryClientInit } from "../src/repositories/analytics/analytics-bigquery-credentials.js";
import {
  ANALYTICS_CLIENT_EVENTS_EXPECTED_FIELDS,
  buildClientEventsTableSchemaJson,
  buildCreateClientEventsTableSql,
  compareClientEventsSchema
} from "../src/repositories/analytics/analytics-bigquery-expected-schema.js";

type CheckResult =
  | "PASS"
  | "FAIL_MISSING_DATASET"
  | "FAIL_MISSING_TABLE"
  | "FAIL_SCHEMA_MISMATCH"
  | "FAIL_METADATA_READ"
  | "FAIL_PERMISSION_DENIED"
  | "FAIL_CONFIG_MISMATCH"
  | "UNKNOWN_ERROR";

function isPermissionError(message: string): boolean {
  return /permission|access denied|denied/i.test(message);
}

function parseArgs(argv: string[]): { writeTest: boolean } {
  return { writeTest: argv.includes("--write-test") || process.env.ANALYTICS_BIGQUERY_TEST_WRITE === "1" };
}

function printGcloudFixCommands(projectId: string, dataset: string, email: string | null): void {
  console.log("\n--- IAM fix (replace member if email is null) ---\n");
  if (!email) {
    console.log("# serviceAccountEmail unknown — fix JSON key path / ANALYTICS_BIGQUERY_* env, then re-run.");
    return;
  }
  console.log(
    [
      `gcloud projects add-iam-policy-binding ${projectId} \\`,
      `  --member="serviceAccount:${email}" \\`,
      `  --role="roles/bigquery.jobUser"`,
      ``,
      `bq add-iam-policy-binding \\`,
      `  --member="serviceAccount:${email}" \\`,
      `  --role="roles/bigquery.dataEditor" \\`,
      `  ${projectId}:${dataset}`
    ].join("\n")
  );
}

function printCurlExample(): void {
  console.log("\n--- Send one test analytics event (local Backendv2 on 8080) ---\n");
  console.log(`curl -sS -X POST "http://127.0.0.1:8080/api/analytics/v2/events" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{"eventId":"cli-probe-1","event":"app_open","sessionId":"cli-session","anonId":"cli-anon","installId":"cli-install","properties":{"source":"bq_debug_cli"}}]}'`);
}

function printBqVerifyQuery(projectId: string, dataset: string, table: string): void {
  console.log("\n--- Confirm rows in BigQuery ---\n");
  const fq = `\`${projectId}.${dataset}.${table}\``;
  console.log(
    `bq query --use_legacy_sql=false --project_id=${projectId} ` +
      `'SELECT event, anonId, receivedAt FROM ${fq} WHERE anonId = "cli-anon" ORDER BY receivedAt DESC LIMIT 5'`
  );
}

async function main(): Promise<void> {
  const { writeTest } = parseArgs(process.argv);
  const env = loadEnv(process.env);
  const runtime = getAnalyticsBigQueryRuntimeConfig(env);
  const init = resolveAnalyticsBigQueryClientInit(env);

  console.log("=== Analytics BigQuery diagnostics ===\n");
  console.log(`projectId:          ${runtime.projectId ?? "(missing)"}`);
  console.log(`dataset:            ${runtime.dataset ?? "(missing)"}`);
  console.log(`table:              ${runtime.table ?? "(missing)"}`);
  console.log(`analyticsEnabled:   ${runtime.analyticsEnabled}`);
  console.log(`bigQueryEnabled:    ${runtime.bigQueryEnabled}`);
  console.log(`credentialSource:   ${runtime.credentialSource}`);
  console.log(`serviceAccountEmail:${runtime.serviceAccountEmail ? ` ${runtime.serviceAccountEmail}` : " (unknown)"}`);
  console.log(`writeTest:          ${writeTest ? "yes (--write-test or ANALYTICS_BIGQUERY_TEST_WRITE=1)" : "no"}`);

  if (!runtime.enabled || !runtime.projectId || !runtime.dataset || !runtime.table) {
    console.log(
      "\n" +
        JSON.stringify({
          result: "FAIL_CONFIG_MISMATCH" satisfies CheckResult,
          detail: "Analytics BigQuery runtime config is incomplete or disabled by env."
        })
    );
    process.exitCode = 1;
    return;
  }

  const bigQuery = new BigQuery(init.bigQueryOptions);
  const dataset = bigQuery.dataset(runtime.dataset);
  const table = dataset.table(runtime.table);

  let metadataReadOk = false;
  let schemaIssues: string[] = [];

  try {
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      console.log(
        "\n" +
          JSON.stringify({
            result: "FAIL_MISSING_DATASET" satisfies CheckResult,
            detail: `Dataset ${runtime.projectId}:${runtime.dataset} does not exist.`
          })
      );
      console.log("\nCreate dataset:\n");
      console.log(`bq mk --dataset --location=US ${runtime.projectId}:${runtime.dataset}`);
      printGcloudFixCommands(runtime.projectId, runtime.dataset, runtime.serviceAccountEmail);
      process.exitCode = 1;
      return;
    }

    const [tableExists] = await table.exists();
    if (!tableExists) {
      console.log(
        "\n" +
          JSON.stringify({
            result: "FAIL_MISSING_TABLE" satisfies CheckResult,
            detail: `Table ${runtime.projectId}:${runtime.dataset}.${runtime.table} does not exist.`
          })
      );
      console.log("\nSchema JSON (save as client-events-schema.json):\n");
      console.log(buildClientEventsTableSchemaJson());
      console.log("\nCreate table:\n");
      console.log(
        `bq mk --table ${runtime.projectId}:${runtime.dataset}.${runtime.table} client-events-schema.json`
      );
      console.log("\nOr SQL:\n");
      console.log(buildCreateClientEventsTableSql(runtime.projectId, runtime.dataset, runtime.table));
      printGcloudFixCommands(runtime.projectId, runtime.dataset, runtime.serviceAccountEmail);
      process.exitCode = 1;
      return;
    }

    const [metadata] = await table.getMetadata();
    metadataReadOk = true;
    const fields = (metadata.schema?.fields ?? []) as Array<{ name?: string; type?: string }>;
    const schemaCheck = compareClientEventsSchema(fields);
    schemaIssues = schemaCheck.issues;
    if (schemaIssues.length > 0) {
      console.log(
        "\n" +
          JSON.stringify({
            result: "FAIL_SCHEMA_MISMATCH" satisfies CheckResult,
            issues: schemaIssues,
            detail: "Table exists but schema does not match publisher expectations."
          })
      );
      console.log("\nExpected fields:\n", ANALYTICS_CLIENT_EVENTS_EXPECTED_FIELDS.map((f) => `${f.name}:${f.type}`).join(", "));
      process.exitCode = 1;
      return;
    }

    console.log(`\nmetadataRead:       OK (table.getMetadata)`);

    if (!writeTest) {
      console.log(
        "\n" +
          JSON.stringify({
            result: "PASS" satisfies CheckResult,
            metadataReadOk,
            schemaOk: true,
            detail: "Dataset/table/schema checks passed. Re-run with --write-test to insert one probe row."
          })
      );
      printGcloudFixCommands(runtime.projectId, runtime.dataset, runtime.serviceAccountEmail);
      printCurlExample();
      printBqVerifyQuery(runtime.projectId, runtime.dataset, runtime.table);
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
        properties: JSON.stringify({ probeId, source: "check-bigquery-analytics-access" })
      }
    ]);
    console.log(
      "\n" +
        JSON.stringify({
          result: "PASS" satisfies CheckResult,
          metadataReadOk,
          schemaOk: true,
          detail: "Metadata checks passed and test write succeeded.",
          probeId
        })
    );
    printGcloudFixCommands(runtime.projectId, runtime.dataset, runtime.serviceAccountEmail);
    printCurlExample();
    printBqVerifyQuery(runtime.projectId, runtime.dataset, runtime.table);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingPermission = extractMissingBigQueryPermission(message);
    let result: CheckResult = isPermissionError(message) ? "FAIL_PERMISSION_DENIED" : "UNKNOWN_ERROR";
    if (!metadataReadOk && /metadata|Not found|404/i.test(message)) {
      result = "FAIL_METADATA_READ";
    }
    console.log(
      "\n" +
        JSON.stringify({
          result,
          detail: message,
          missingPermission,
          credentialSource: runtime.credentialSource,
          serviceAccountEmail: runtime.serviceAccountEmail
        })
    );
    printGcloudFixCommands(runtime.projectId!, runtime.dataset!, runtime.serviceAccountEmail);
    process.exitCode = 1;
  }
}

await main();
