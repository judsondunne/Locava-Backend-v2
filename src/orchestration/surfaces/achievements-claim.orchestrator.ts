import type { AchievementsClaimResponse } from "../../contracts/surfaces/achievements-claim.contract.js";
import type { AchievementsService } from "../../services/surfaces/achievements.service.js";

export class AchievementsClaimOrchestrator {
  constructor(private readonly service: AchievementsService) {}

  async run(input: {
    viewerId: string;
    kind: "weekly_capture" | "badge" | "challenge";
    id: string;
    source?: "static" | "competitive";
  }): Promise<AchievementsClaimResponse> {
    const reward = await this.service.claimByKind(input.viewerId, {
      kind: input.kind,
      id: input.id,
      source: input.source
    });
    return {
      routeName: "achievements.claim.post",
      kind: input.kind,
      id: input.id,
      source: input.source ?? null,
      reward,
      degraded: false,
      fallbacks: []
    };
  }
}
