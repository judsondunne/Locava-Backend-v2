import type { OsmNationalEvent } from "../../../contracts/entities/osm-national-entities.contract.js";
import type { OsmNationalEventType } from "../../../contracts/entities/osm-national-entities.contract.js";
import { buildOsmNationalEventId } from "./osmNationalDeterministicIds.js";
import { writeOsmNationalEvent, type OsmNationalWriteOptions } from "../../../repositories/source-of-truth/osm-national-runs-firestore.adapter.js";

const THROTTLE_MS = 2000;
const lastEventAt = new Map<string, number>();

function throttleKey(runId: string, type: OsmNationalEventType, chunkId?: string): string {
  return `${runId}:${type}:${chunkId ?? ""}`;
}

export async function logOsmNationalEvent(input: {
  runId: string;
  stateCode?: string;
  chunkId?: string;
  level: OsmNationalEvent["level"];
  type: OsmNationalEventType;
  message: string;
  counts?: Record<string, number>;
  writeOptions: OsmNationalWriteOptions;
  force?: boolean;
}): Promise<OsmNationalEvent | null> {
  const key = throttleKey(input.runId, input.type, input.chunkId);
  const now = Date.now();
  const last = lastEventAt.get(key) ?? 0;
  if (!input.force && now - last < THROTTLE_MS) {
    console.log(`[osm-national] ${input.type}: ${input.message}`);
    return null;
  }
  lastEventAt.set(key, now);

  const event: OsmNationalEvent = {
    eventId: buildOsmNationalEventId(),
    runId: input.runId,
    stateCode: input.stateCode,
    chunkId: input.chunkId,
    level: input.level,
    type: input.type,
    message: input.message,
    counts: input.counts,
    createdAt: new Date().toISOString(),
  };

  console.log(`[osm-national] ${input.type}: ${input.message}`);
  try {
    await writeOsmNationalEvent(event, input.writeOptions);
  } catch (error) {
    console.warn("osm_national_event_write_failed", error instanceof Error ? error.message : String(error));
  }
  return event;
}

export function resetOsmNationalEventThrottleForTests(): void {
  lastEventAt.clear();
}
