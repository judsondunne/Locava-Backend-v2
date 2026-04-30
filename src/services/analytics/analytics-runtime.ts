import type { AppEnv } from "../../config/env.js";
import { BigQueryAnalyticsPublisher, type AnalyticsPublisher } from "../../repositories/analytics/analytics-publisher.js";
import { AnalyticsIngestService } from "./analytics-ingest.service.js";

let runtime: AnalyticsIngestService | null = null;

export function getAnalyticsIngestService(env: AppEnv): AnalyticsIngestService {
  if (!runtime) {
    runtime = new AnalyticsIngestService(env, new BigQueryAnalyticsPublisher(env));
  }
  return runtime;
}

export function setAnalyticsIngestServiceForTests(service: AnalyticsIngestService | null): void {
  runtime = service;
}

export function createAnalyticsIngestServiceForTests(env: AppEnv, publisher: AnalyticsPublisher): AnalyticsIngestService {
  return new AnalyticsIngestService(env, publisher);
}
