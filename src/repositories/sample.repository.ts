import { incrementDbOps } from "../observability/request-context.js";

export type SampleRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export class SampleRepository {
  async fetchSampleRecords(limit: number): Promise<SampleRecord[]> {
    incrementDbOps("queries", 1);
    incrementDbOps("reads", limit);

    return Array.from({ length: limit }).map((_, i) => ({
      id: `sample-${i + 1}`,
      name: `Sample ${i + 1}`,
      createdAt: new Date().toISOString()
    }));
  }

  async simulateWrites(count: number): Promise<void> {
    incrementDbOps("writes", count);
  }
}
