import type { AchievementsClaimBadgeResponse } from "../../contracts/surfaces/achievements-claim-badge.contract.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsClaimBadgeOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string; badgeId: string }): Promise<AchievementsClaimBadgeResponse> {
    const reward = await this.service.claimBadgeReward(input.viewerId, input.badgeId);
    return {
      routeName: "achievements.claimbadge.post",
      reward,
      degraded: false,
      fallbacks: []
    };
  }
}
