import type { AchievementsClaimChallengeResponse } from "../../contracts/surfaces/achievements-claim-challenge.contract.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsClaimChallengeOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string; challengeId: string }): Promise<AchievementsClaimChallengeResponse> {
    const reward = await this.service.claimChallengeReward(input.viewerId, input.challengeId);
    return {
      routeName: "achievements.claimchallenge.post",
      reward,
      degraded: false,
      fallbacks: []
    };
  }
}
