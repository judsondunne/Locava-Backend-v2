import type { AchievementsLeaderboardAckResponse } from "../../contracts/surfaces/achievements-leaderboard-ack.contract.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsLeaderboardAckOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: { viewerId: string; eventId: string }): Promise<AchievementsLeaderboardAckResponse> {
    const { recordedAtMs, acknowledged } = await this.service.recordLeaderboardAck(input.viewerId, input.eventId);
    return {
      routeName: "achievements.leaderboardack.post",
      ok: true,
      acknowledged,
      recordedAtMs
    };
  }
}
