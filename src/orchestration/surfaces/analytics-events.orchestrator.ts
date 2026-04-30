import type { AnalyticsEventsBody } from "../../contracts/surfaces/analytics-events.contract.js";
import type { AnalyticsIngestService } from "../../services/analytics/analytics-ingest.service.js";

export class AnalyticsEventsOrchestrator {
  constructor(private readonly ingestService: AnalyticsIngestService) {}

  async run(input: {
    body: AnalyticsEventsBody;
    requestUserId?: string | null;
    requestIp?: string | null;
    userAgent?: string | null;
  }) {
    return this.ingestService.acceptBatch({
      events: input.body.events,
      requestUserId: input.requestUserId ?? null,
      requestIp: input.requestIp ?? null,
      userAgent: input.userAgent ?? null
    });
  }
}
