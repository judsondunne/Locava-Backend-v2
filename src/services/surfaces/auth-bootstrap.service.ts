import type { AuthBootstrapRepository } from "../../repositories/surfaces/auth-bootstrap.repository.js";
import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";

export class AuthBootstrapService {
  constructor(private readonly repository: AuthBootstrapRepository) {}

  async loadSession(viewerId: string) {
    return dedupeInFlight(`session:${viewerId}`, () =>
      withConcurrencyLimit("auth-session-repo", 8, () => this.repository.getSessionRecord(viewerId))
    );
  }

  async loadViewerSummary(viewerId: string, slowMs: number) {
    return dedupeInFlight(`viewer-summary:${viewerId}:${slowMs}`, () =>
      withConcurrencyLimit("auth-viewer-summary-repo", 6, () =>
        this.repository.getViewerSummary(viewerId, slowMs)
      )
    );
  }

  async loadBootstrapSeed(viewerId: string, slowMs: number) {
    return dedupeInFlight(`bootstrap-seed:${viewerId}:${slowMs}`, () =>
      withConcurrencyLimit("auth-bootstrap-seed-repo", 6, () =>
        this.repository.getBootstrapSeed(viewerId, slowMs)
      )
    );
  }
}
