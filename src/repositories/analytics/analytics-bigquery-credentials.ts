import fs from "node:fs";
import path from "node:path";
import type { AppEnv } from "../../config/env.js";

/**
 * BigQuery credential source for **analytics ingest only** (never Firebase Admin env keys).
 * Parity: legacy `Locava Backend/src/services/analytics/bigqueryWriter.ts` used
 * `new BigQuery({ projectId })` + ADC (`GOOGLE_APPLICATION_CREDENTIALS`); Backendv2 prefers
 * `ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_*` so Firebase Admin can stay on `firebase-adminsdk-*`.
 */
export type AnalyticsBigQueryCredentialSource =
  | "analytics_service_account_json"
  | "analytics_service_account_file"
  | "google_application_credentials"
  | "adc_default";

export type AnalyticsBigQueryTableLocation = {
  projectId: string | null;
  dataset: string;
  table: string;
};

export type AnalyticsBigQueryClientInit = {
  credentialSource: AnalyticsBigQueryCredentialSource;
  /** client_email for the credential used to talk to BigQuery (never a private key). */
  serviceAccountEmail: string | null;
  /** Options passed to `new BigQuery(...)`. Never log this object — it may contain a private_key. */
  bigQueryOptions: { projectId?: string; keyFilename?: string; credentials?: Record<string, unknown> };
};

function stripQuotes(value: string | undefined): string | undefined {
  if (!value) return value;
  const t = value.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function readJsonFileSafe(filePath: string): Record<string, unknown> | null {
  try {
    const resolved = path.resolve(filePath);
    const raw = fs.readFileSync(resolved, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseServiceAccountJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function extractServiceAccountEmailFromParsed(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;
  const email = parsed.client_email;
  return typeof email === "string" && email.includes("@") ? email.trim() : null;
}

/**
 * Resolves BigQuery **table** location for analytics ingest.
 * Matches legacy Locava Backend `bigqueryWriter.ts`:
 * - project: `GCP_PROJECT_ID || GOOGLE_CLOUD_PROJECT` (plus optional `ANALYTICS_BIGQUERY_PROJECT_ID` override)
 * - dataset / table: `ANALYTICS_DATASET` / `ANALYTICS_EVENTS_TABLE` defaults, with `ANALYTICS_BIGQUERY_*` overrides.
 */
export function resolveAnalyticsBigQueryTableLocation(
  env: AppEnv,
  processEnv: NodeJS.ProcessEnv = process.env
): AnalyticsBigQueryTableLocation {
  const projectId =
    env.ANALYTICS_BIGQUERY_PROJECT_ID?.trim() ||
    env.GCP_PROJECT_ID?.trim() ||
    (typeof processEnv.GOOGLE_CLOUD_PROJECT === "string" ? processEnv.GOOGLE_CLOUD_PROJECT.trim() : "") ||
    null;
  const dataset =
    env.ANALYTICS_BIGQUERY_DATASET?.trim() || env.ANALYTICS_DATASET?.trim() || "analytics_prod";
  const table = env.ANALYTICS_BIGQUERY_TABLE?.trim() || env.ANALYTICS_EVENTS_TABLE?.trim() || "client_events";
  return { projectId: projectId || null, dataset, table };
}

export function formatAnalyticsBigQueryCredentialSource(source: AnalyticsBigQueryCredentialSource): string {
  switch (source) {
    case "analytics_service_account_json":
      return "analytics-json";
    case "analytics_service_account_file":
      return "analytics-file";
    case "google_application_credentials":
      return "shared-gadc";
    case "adc_default":
      return "adc";
    default:
      return source;
  }
}

export function serviceAccountEmailLooksLikeFirebaseAdminSdk(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().includes("firebase-adminsdk"));
}

export function buildAnalyticsBigQueryStartupWarnings(
  bigQueryEnabled: boolean,
  credentialSource: AnalyticsBigQueryCredentialSource,
  serviceAccountEmail: string | null
): string[] {
  if (!bigQueryEnabled) return [];
  const warnings: string[] = [];
  if (credentialSource === "google_application_credentials") {
    warnings.push(
      "BigQuery analytics uses GOOGLE_APPLICATION_CREDENTIALS (same as legacy Locava Backend bigqueryWriter). Prefer ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_FILE/JSON with the dedicated analytics writer key so Firebase Admin stays on firebase-adminsdk-* only."
    );
  }
  if (credentialSource === "adc_default") {
    warnings.push(
      "BigQuery analytics uses Application Default Credentials with no ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_* or GOOGLE_APPLICATION_CREDENTIALS — set ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_FILE to the legacy analytics key for predictable behavior."
    );
  }
  if (serviceAccountEmailLooksLikeFirebaseAdminSdk(serviceAccountEmail)) {
    warnings.push(
      "The active BigQuery credential client_email looks like a Firebase Admin SDK service account. If BigQuery writes fail, grant roles/bigquery.jobUser (project) and BigQuery Data Editor on analytics_prod, or use a separate analytics service account JSON."
    );
  }
  return warnings;
}

/**
 * Resolves BigQuery client options for analytics ingest only.
 * Never reads FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL for BigQuery.
 */
export function resolveAnalyticsBigQueryClientInit(env: AppEnv, processEnv: NodeJS.ProcessEnv = process.env): AnalyticsBigQueryClientInit {
  const { projectId: analyticsProjectId } = resolveAnalyticsBigQueryTableLocation(env, processEnv);
  const projectId = analyticsProjectId ?? undefined;

  const jsonRaw = env.ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_JSON?.trim();
  if (jsonRaw) {
    const parsed = parseServiceAccountJson(jsonRaw);
    const serviceAccountEmail = extractServiceAccountEmailFromParsed(parsed);
    if (parsed?.private_key && parsed?.client_email) {
      return {
        credentialSource: "analytics_service_account_json",
        serviceAccountEmail,
        bigQueryOptions: {
          projectId,
          credentials: {
            client_email: parsed.client_email,
            private_key: parsed.private_key
          }
        }
      };
    }
  }

  const fileRaw = env.ANALYTICS_BIGQUERY_SERVICE_ACCOUNT_FILE?.trim();
  if (fileRaw) {
    const resolvedPath = path.resolve(fileRaw);
    const parsed = readJsonFileSafe(resolvedPath);
    const serviceAccountEmail = extractServiceAccountEmailFromParsed(parsed);
    if (parsed?.private_key && parsed?.client_email) {
      return {
        credentialSource: "analytics_service_account_file",
        serviceAccountEmail,
        bigQueryOptions: {
          projectId,
          credentials: {
            client_email: parsed.client_email,
            private_key: parsed.private_key
          }
        }
      };
    }
  }

  const gadc = stripQuotes(processEnv.GOOGLE_APPLICATION_CREDENTIALS)?.trim();
  if (gadc) {
    const parsed = readJsonFileSafe(gadc);
    const serviceAccountEmail = extractServiceAccountEmailFromParsed(parsed);
    return {
      credentialSource: "google_application_credentials",
      serviceAccountEmail,
      bigQueryOptions: { projectId, keyFilename: path.resolve(gadc) }
    };
  }

  return {
    credentialSource: "adc_default",
    serviceAccountEmail: null,
    bigQueryOptions: { projectId }
  };
}
