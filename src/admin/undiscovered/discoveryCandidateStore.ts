import {
  canTransitionDiscoveryStatus,
  DiscoveryCandidateSchema,
  type DiscoveryCandidate,
  type DiscoveryReviewStatus,
} from "../../contracts/surfaces/undiscovered-candidate.contract.js";

/**
 * In-memory discovery-candidate store for Dashboard v1.
 *
 * v1 keeps the review queue in process memory so the dashboard is usable
 * locally without Firebase creds. The interface is intentionally the seam a
 * Firestore-backed store would implement later (`unexploredSpots` writes stay
 * behind the existing PBF write guards — this store only manages the review
 * queue, never the production collections).
 */

export type DiscoveryStatusCounts = Record<DiscoveryReviewStatus, number>;

export interface DiscoveryCandidateFilter {
  region?: string;
  status?: DiscoveryReviewStatus;
  channel?: DiscoveryCandidate["sourceChannel"];
  category?: string;
}

export class DiscoveryCandidateStore {
  private readonly byId = new Map<string, DiscoveryCandidate>();

  /** Insert or replace many candidates (idempotent by id). Preserves review state on re-seed. */
  upsertMany(candidates: DiscoveryCandidate[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;
    for (const raw of candidates) {
      const parsed = DiscoveryCandidateSchema.parse(raw);
      const existing = this.byId.get(parsed.id);
      if (existing) {
        // Re-seeding must not clobber human review progress.
        this.byId.set(parsed.id, {
          ...parsed,
          reviewStatus: existing.reviewStatus,
          reviewNotes: existing.reviewNotes,
          reviewedBy: existing.reviewedBy,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        });
        updated += 1;
      } else {
        this.byId.set(parsed.id, parsed);
        inserted += 1;
      }
    }
    return { inserted, updated };
  }

  get(id: string): DiscoveryCandidate | undefined {
    return this.byId.get(id);
  }

  list(filter: DiscoveryCandidateFilter = {}): DiscoveryCandidate[] {
    const out: DiscoveryCandidate[] = [];
    for (const c of this.byId.values()) {
      if (filter.region && c.region !== filter.region) continue;
      if (filter.status && c.reviewStatus !== filter.status) continue;
      if (filter.channel && c.sourceChannel !== filter.channel) continue;
      if (filter.category && c.primaryCategory !== filter.category) continue;
      out.push(c);
    }
    // Stable, useful ordering: quality-passing first, then name.
    out.sort((a, b) => {
      if (a.qualityGate.passed !== b.qualityGate.passed) return a.qualityGate.passed ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return out;
  }

  /**
   * Apply a review transition. Returns the updated candidate, or an error
   * describing why the transition is not allowed.
   */
  setStatus(
    id: string,
    to: DiscoveryReviewStatus,
    patch: { reviewNotes?: string; reviewedBy?: string } = {},
  ): { ok: true; candidate: DiscoveryCandidate } | { ok: false; code: string; message: string } {
    const current = this.byId.get(id);
    if (!current) {
      return { ok: false, code: "not_found", message: `No candidate with id ${id}` };
    }
    if (current.reviewStatus === to) {
      return { ok: false, code: "no_op", message: `Candidate already ${to}` };
    }
    if (!canTransitionDiscoveryStatus(current.reviewStatus, to)) {
      return {
        ok: false,
        code: "invalid_transition",
        message: `Cannot move ${current.reviewStatus} → ${to}`,
      };
    }
    const updated: DiscoveryCandidate = {
      ...current,
      reviewStatus: to,
      reviewNotes: patch.reviewNotes ?? current.reviewNotes,
      reviewedBy: patch.reviewedBy ?? current.reviewedBy,
      updatedAt: new Date().toISOString(),
    };
    this.byId.set(id, updated);
    return { ok: true, candidate: updated };
  }

  counts(filter: Omit<DiscoveryCandidateFilter, "status"> = {}): DiscoveryStatusCounts {
    const counts: DiscoveryStatusCounts = {
      candidate: 0,
      reviewed: 0,
      approved: 0,
      rejected: 0,
      written: 0,
    };
    for (const c of this.list(filter)) {
      counts[c.reviewStatus] += 1;
    }
    return counts;
  }

  countsByCategory(filter: DiscoveryCandidateFilter = {}): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.list(filter)) {
      out[c.primaryCategory] = (out[c.primaryCategory] ?? 0) + 1;
    }
    return out;
  }

  size(): number {
    return this.byId.size;
  }

  clear(): void {
    this.byId.clear();
  }
}

/** Process-wide singleton used by the dashboard routes. */
let singleton: DiscoveryCandidateStore | null = null;
export function getDiscoveryCandidateStore(): DiscoveryCandidateStore {
  if (!singleton) singleton = new DiscoveryCandidateStore();
  return singleton;
}
