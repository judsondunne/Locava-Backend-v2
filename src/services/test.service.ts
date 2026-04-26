import { SampleRepository } from "../repositories/sample.repository.js";

export class TestService {
  constructor(private readonly repository = new SampleRepository()) {}

  async simulateDb(reads: number, writes: number): Promise<{ records: number; writes: number }> {
    const records = await this.repository.fetchSampleRecords(reads);
    await this.repository.simulateWrites(writes);
    return { records: records.length, writes };
  }
}
