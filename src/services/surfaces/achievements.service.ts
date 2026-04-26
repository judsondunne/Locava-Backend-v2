import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import type {
  AchievementClaimRewardPayload,
  AchievementHeroSummary,
  AchievementLeaderboardScope,
  AchievementLeagueDefinition,
  AchievementPendingDelta,
  AchievementSnapshot,
  AchievementsCanonicalBadgeRow,
  AchievementsCanonicalStatus
} from "../../contracts/entities/achievement-entities.contract.js";
import {
  projectCanonicalBadgeRowsFromSnapshot,
  projectCanonicalStatusFromSnapshot
} from "../../repositories/surfaces/achievements.repository.js";
import type {
  AchievementBootstrapShellRead,
  AchievementsRepository,
  LeaderboardReadModel
} from "../../repositories/surfaces/achievements.repository.js";

export class AchievementsService {
  constructor(private readonly repository: AchievementsRepository) {}

  private buildHeroFromSnapshot(
    snapshot: AchievementSnapshot,
    leagues: AchievementLeagueDefinition[]
  ): AchievementHeroSummary {
    const sorted = [...leagues].sort((a, b) => a.order - b.order);
    const currentLeague =
      sorted.find((league) => snapshot.xp.current >= league.minXP && snapshot.xp.current <= league.maxXP) ??
      sorted[sorted.length - 1] ??
      null;
    return {
      xp: {
        ...snapshot.xp,
        tier: currentLeague?.title ?? snapshot.xp.tier
      },
      streak: snapshot.streak,
      totalPosts: snapshot.totalPosts,
      globalRank: snapshot.globalRank
    };
  }

  private buildClaimablesFromSnapshot(snapshot: AchievementSnapshot): {
    totalCount: number;
    weeklyCaptures: Array<{ id: string; title: string; xpReward: number }>;
    badges: Array<{ id: string; title: string; source: "static" | "competitive"; rewardPoints: number }>;
    challenges: Array<{ id: string; title: string; rewardPoints: number }>;
  } {
    const weeklyCaptures = snapshot.weeklyCaptures
      .filter((capture) => capture.completed && !capture.claimed)
      .map((capture) => ({
        id: capture.id,
        title: capture.title,
        xpReward: capture.xpReward
      }));
    const badges = snapshot.badges
      .filter((badge) => badge.earned && !badge.claimed)
      .map((badge) => ({
        id: badge.id,
        title: badge.title,
        source: (badge.badgeSource === "competitive" ? "competitive" : "static") as "static" | "competitive",
        rewardPoints: Math.max(0, badge.rewardPoints ?? 0)
      }));
    const challenges = snapshot.challenges
      .filter((challenge) => challenge.claimable && !challenge.claimed)
      .map((challenge) => ({
        id: challenge.id,
        title: challenge.title,
        rewardPoints: 0
      }));
    return {
      totalCount: weeklyCaptures.length + badges.length + challenges.length,
      weeklyCaptures,
      badges,
      challenges
    };
  }

  async loadHero(viewerId: string): Promise<AchievementHeroSummary> {
    return dedupeInFlight(`achievements:hero:${viewerId}`, () =>
      withConcurrencyLimit("achievements-hero-repo", 6, () => this.repository.getHero(viewerId))
    );
  }

  async loadSnapshot(viewerId: string): Promise<AchievementSnapshot> {
    return dedupeInFlight(`achievements:snapshot:${viewerId}`, () =>
      withConcurrencyLimit("achievements-snapshot-repo", 6, () => this.repository.getSnapshot(viewerId))
    );
  }

  async loadStatusSurface(viewerId: string): Promise<AchievementsCanonicalStatus> {
    return dedupeInFlight(`achievements:status:${viewerId}`, () =>
      withConcurrencyLimit("achievements-status-repo", 6, () => this.repository.getCanonicalStatus(viewerId))
    );
  }

  async loadBadgeRows(viewerId: string): Promise<AchievementsCanonicalBadgeRow[]> {
    const snapshot = await this.loadSnapshot(viewerId);
    return projectCanonicalBadgeRowsFromSnapshot(snapshot);
  }

  async recordScreenOpened(viewerId: string): Promise<{ recordedAtMs: number }> {
    return dedupeInFlight(`achievements:screen-opened:${viewerId}`, () =>
      withConcurrencyLimit("achievements-screen-opened-repo", 4, () => this.repository.recordScreenOpened(viewerId))
    );
  }

  async consumePendingDelta(viewerId: string): Promise<AchievementPendingDelta | null> {
    return dedupeInFlight(`achievements:pending-delta:${viewerId}`, () =>
      withConcurrencyLimit("achievements-pendingdelta-repo", 8, () => this.repository.takePendingDelta(viewerId))
    );
  }

  async loadLeagues(): Promise<AchievementLeagueDefinition[]> {
    return dedupeInFlight("achievements:leagues:all", () =>
      withConcurrencyLimit("achievements-leagues-repo", 4, () => this.repository.getLeagueDefinitions())
    );
  }

  async loadLeaderboardRead(
    viewerId: string,
    scope: AchievementLeaderboardScope,
    leagueId?: string | null
  ): Promise<LeaderboardReadModel> {
    const key = `achievements:lb:${viewerId}:${scope}:${leagueId?.trim() ?? ""}`;
    return dedupeInFlight(key, () =>
      withConcurrencyLimit("achievements-leaderboard-repo", 8, () =>
        this.repository.getLeaderboardRead(viewerId, scope, leagueId)
      )
    );
  }

  async recordLeaderboardAck(viewerId: string, eventId: string): Promise<{ recordedAtMs: number; acknowledged: boolean }> {
    return dedupeInFlight(`achievements:lb-ack:${viewerId}:${eventId}`, () =>
      withConcurrencyLimit("achievements-lb-ack-repo", 8, () => this.repository.recordLeaderboardAck(viewerId, eventId))
    );
  }

  async claimWeeklyCapture(viewerId: string, captureId: string): Promise<AchievementClaimRewardPayload> {
    return dedupeInFlight(`achievements:claim:wc:${viewerId}:${captureId}`, () =>
      withConcurrencyLimit("achievements-claim-repo", 6, () => this.repository.claimWeeklyCapture(viewerId, captureId))
    );
  }

  async claimBadgeReward(viewerId: string, badgeId: string): Promise<AchievementClaimRewardPayload> {
    return dedupeInFlight(`achievements:claim:badge:${viewerId}:${badgeId}`, () =>
      withConcurrencyLimit("achievements-claim-repo", 6, () => this.repository.claimBadge(viewerId, badgeId))
    );
  }

  async claimBadgeRewardBySource(
    viewerId: string,
    badgeId: string,
    source?: "static" | "competitive"
  ): Promise<AchievementClaimRewardPayload> {
    return dedupeInFlight(`achievements:claim:badge:${viewerId}:${badgeId}:${source ?? "auto"}`, () =>
      withConcurrencyLimit("achievements-claim-repo", 6, () => this.repository.claimBadge(viewerId, badgeId, source))
    );
  }

  async claimChallengeReward(viewerId: string, challengeId: string): Promise<AchievementClaimRewardPayload> {
    return dedupeInFlight(`achievements:claim:ch:${viewerId}:${challengeId}`, () =>
      withConcurrencyLimit("achievements-claim-repo", 6, () => this.repository.claimChallenge(viewerId, challengeId))
    );
  }

  async loadClaimables(viewerId: string): Promise<{
    totalCount: number;
    weeklyCaptures: Array<{ id: string; title: string; xpReward: number }>;
    badges: Array<{ id: string; title: string; source: "static" | "competitive"; rewardPoints: number }>;
    challenges: Array<{ id: string; title: string; rewardPoints: number }>;
  }> {
    return this.repository.getClaimables(viewerId);
  }

  async loadBootstrap(viewerId: string): Promise<{
    hero: AchievementHeroSummary;
    snapshot: AchievementSnapshot;
    leagues: AchievementLeagueDefinition[];
    claimables: Awaited<ReturnType<AchievementsService["loadClaimables"]>>;
  }> {
    const [snapshot, leagues] = await Promise.all([
      this.loadSnapshot(viewerId),
      this.loadLeagues()
    ]);
    const hero = this.buildHeroFromSnapshot(snapshot, leagues);
    const claimables = this.buildClaimablesFromSnapshot(snapshot);
    return {
      hero,
      snapshot,
      leagues,
      claimables
    };
  }

  async loadBootstrapShell(viewerId: string): Promise<AchievementBootstrapShellRead> {
    return dedupeInFlight(`achievements:bootstrap-shell:${viewerId}`, () =>
      withConcurrencyLimit("achievements-bootstrap-shell-repo", 6, () => this.repository.getBootstrapShell(viewerId))
    );
  }

  async claimByKind(
    viewerId: string,
    input: { kind: "weekly_capture" | "badge" | "challenge"; id: string; source?: "static" | "competitive" }
  ): Promise<AchievementClaimRewardPayload> {
    if (input.kind === "weekly_capture") {
      return this.claimWeeklyCapture(viewerId, input.id);
    }
    if (input.kind === "badge") {
      return this.claimBadgeRewardBySource(viewerId, input.id, input.source);
    }
    return this.claimChallengeReward(viewerId, input.id);
  }
}
