import { CompatUserFullService } from "../../services/compat/user-full.service.js";

export class CompatUserFullOrchestrator {
  constructor(private readonly service = new CompatUserFullService()) {}

  async run(input: {
    viewerId: string;
    targetUserId: string;
    profileBootstrap: Record<string, unknown>;
  }): Promise<{ success: true; userData: Record<string, unknown> }> {
    const userData = await this.service.buildUserData(input);
    return { success: true, userData };
  }
}

