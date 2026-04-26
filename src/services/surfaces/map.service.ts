import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import type { MapRepository } from "../../repositories/surfaces/map.repository.js";

export class MapService {
  constructor(private readonly repository: MapRepository) {}

  parseBounds(rawBbox: string) {
    return this.repository.parseBounds(rawBbox);
  }

  async loadBootstrap(input: { bbox: string; limit: number }) {
    return dedupeInFlight(`map:bootstrap:${input.bbox}:${input.limit}`, () =>
      withConcurrencyLimit("map-bootstrap-repo", 8, async () => {
        const bounds = this.repository.parseBounds(input.bbox);
        const page = await this.repository.listMarkers({ bounds, limit: input.limit });
        return { bounds, ...page };
      })
    );
  }
}
