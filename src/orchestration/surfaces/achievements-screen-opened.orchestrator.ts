import type { AchievementsScreenOpenedResponse } from "../../contracts/surfaces/achievements-screen-opened.contract.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsScreenOpenedOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string }): Promise<AchievementsScreenOpenedResponse> {
    const { recordedAtMs } = await this.service.recordScreenOpened(input.viewerId);
    return {
      routeName: "achievements.screenopened.post",
      ok: true,
      recordedAtMs
    };
  }
}
