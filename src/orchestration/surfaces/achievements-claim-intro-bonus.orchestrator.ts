import type { AchievementsClaimIntroBonusResponse } from "../../contracts/surfaces/achievements-claim-intro-bonus.contract.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsClaimIntroBonusOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsClaimIntroBonusResponse> {
    const result = await this.service.claimIntroBonus(input.viewerId);
    return {
      routeName: "achievements.claimintrobonus.post",
      reward: result.reward,
      alreadyClaimed: result.alreadyClaimed,
      degraded: false,
      fallbacks: []
    };
  }
}
