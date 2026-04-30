import type { MixFilter } from "../../contracts/v2/mixes.contract.js";
import { MixesService } from "../../services/mixes/mixes.service.js";

export class MixesOrchestrator {
  constructor(private readonly service = new MixesService()) {}

  async preview(input: { mixKey: string; filter: MixFilter; limit: number; viewerId: string | null }) {
    return this.service.preview(input);
  }

  async page(input: { mixKey: string; filter: MixFilter; limit: number; cursor: string | null; viewerId: string | null }) {
    return this.service.page(input);
  }
}
