import type { AchievementsClaimWeeklyCaptureResponse } from "../../contracts/surfaces/achievements-claim-weekly-capture.contract.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsClaimWeeklyCaptureOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string; captureId: string }): Promise<AchievementsClaimWeeklyCaptureResponse> {
    const reward = await this.service.claimWeeklyCapture(input.viewerId, input.captureId);
    return {
      routeName: "achievements.claimweeklycapture.post",
      reward,
      degraded: false,
      fallbacks: []
    };
  }
}
