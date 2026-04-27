import { SearchDiscoveryService, type DiscoveryPost } from "../services/surfaces/search-discovery.service.js";

export type MixPostCandidate = DiscoveryPost;

export class PostDiscoveryRepository {
  private readonly discovery = new SearchDiscoveryService();

  async searchPostsForSeed(input: {
    seedQuery: string;
    lat: number | null;
    lng: number | null;
    limit: number;
  }): Promise<MixPostCandidate[]> {
    return this.discovery.searchPostsForQuery(input.seedQuery, {
      limit: input.limit,
      lat: input.lat,
      lng: input.lng,
    });
  }
}

