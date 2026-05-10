import fs from "node:fs";
import path from "node:path";
import type { AppEnv } from "../../config/env.js";

export type AnalyticsBigQueryCredentialSource =
  | "analytics_service_account_json"
  | "analytics_service_account_file"
  | "google_application_credentials"
  | "adc_default";

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
 * Resolves BigQuery client options for analytics ingest only.
 * Does not mutate Firebase Admin env; does not log secrets.
 */
export function resolveAnalyticsBigQueryClientInit(env: AppEnv, processEnv: NodeJS.ProcessEnv = process.env): AnalyticsBigQueryClientInit {
  const projectId = env.GCP_PROJECT_ID?.trim() || undefined;
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
