import { BigQuery, type Table } from "@google-cloud/bigquery";
import type { AppEnv } from "../../config/env.js";

export type AnalyticsRow = {
  event: string;
  schemaVersion: string | null;
  userId: string | null;
  anonId: string | null;
  sessionId: string | null;
  clientTime: Date | null;
  receivedAt: Date;
  platform: string | null;
  requestIp: string | null;
  userAgent: string | null;
  properties: string | null;
  ingestId: string | null;
  eventId: string | null;
};

export type AnalyticsPublisherDestination = {
  enabled: boolean;
  projectId: string | null;
  dataset: string | null;
  table: string | null;
};

export interface AnalyticsPublisher {
  publish(rows: AnalyticsRow[]): Promise<void>;
  getDestination(): AnalyticsPublisherDestination;
}

export class BigQueryAnalyticsPublisher implements AnalyticsPublisher {
  private readonly destination: AnalyticsPublisherDestination;
  private bigQuery: BigQuery | null = null;
  private tableRef: Table | null = null;

  constructor(private readonly env: AppEnv) {
    this.destination = {
      enabled: Boolean(env.ANALYTICS_ENABLED && env.GCP_PROJECT_ID && env.ANALYTICS_DATASET && env.ANALYTICS_EVENTS_TABLE),
      projectId: env.GCP_PROJECT_ID ?? null,
      dataset: env.ANALYTICS_DATASET ?? null,
      table: env.ANALYTICS_EVENTS_TABLE ?? null
    };
  }

  getDestination(): AnalyticsPublisherDestination {
    return { ...this.destination };
  }

  async publish(rows: AnalyticsRow[]): Promise<void> {
    if (!rows.length) return;
    const table = this.ensureTable();
    if (!table) {
      throw new Error("analytics_publisher_unconfigured");
    }
    await table.insert(rows);
  }

  private ensureTable(): Table | null {
    if (!this.destination.enabled) {
      return null;
    }
    if (this.tableRef) {
      return this.tableRef;
    }
    this.bigQuery = new BigQuery({ projectId: this.destination.projectId ?? undefined });
    this.tableRef = this.bigQuery
      .dataset(this.destination.dataset ?? "analytics_prod")
      .table(this.destination.table ?? "client_events");
    return this.tableRef;
  }
}
