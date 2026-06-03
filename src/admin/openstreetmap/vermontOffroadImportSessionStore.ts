import { randomUUID } from "node:crypto";

export type VermontImportLogLevel = "info" | "success" | "warn" | "error";

export type VermontImportLogEntry = {
  ts: string;
  level: VermontImportLogLevel;
  message: string;
  detail?: Record<string, unknown>;
};

export type VermontImportPreview = {
  totalRoutesFetched: number;
  eligibleUndiscoveredPosts: number;
  filteredOutByPublicOnly: number;
  byMapReadiness: Record<string, number>;
  bySourcePrefix: Record<string, number>;
  sourceCounts: Array<{
    sourceId: string;
    rawFeatures: number;
    routesAccepted: number;
    rejected: number;
    errors: string[];
  }>;
};

export type VermontImportWriteResult = {
  requestedLimit: number | "all";
  docsBuilt: number;
  writtenRoutes: number;
  writtenTiles: number;
  writeErrors: number;
  skippedBecauseDryRun: boolean;
  sampleRouteIds: string[];
};

export type VermontImportSessionPhase =
  | "idle"
  | "scanning"
  | "scan_complete"
  | "writing"
  | "write_complete"
  | "failed";

export type VermontImportScanProgress = {
  step: string;
  message: string;
  sourceId?: string | null;
  sourceIndex?: number;
  sourceTotal?: number;
  chunkIndex?: number;
  chunkTotal?: number;
  percentComplete?: number;
  routesAcceptedSoFar?: number;
  elapsedMs?: number;
  includeOsmSupplemental?: boolean;
};

export type VermontImportSession = {
  sessionId: string;
  phase: VermontImportSessionPhase;
  logs: VermontImportLogEntry[];
  runId: string | null;
  preview: VermontImportPreview | null;
  writeResult: VermontImportWriteResult | null;
  scanProgress: VermontImportScanProgress | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  scanStartedAt: string | null;
  scanCompletedAt: string | null;
  writeStartedAt: string | null;
  writeCompletedAt: string | null;
};

const sessions = new Map<string, VermontImportSession>();

function nowIso(): string {
  return new Date().toISOString();
}

export function createVermontImportSession(): VermontImportSession {
  const session: VermontImportSession = {
    sessionId: randomUUID(),
    phase: "idle",
    logs: [],
    runId: null,
    preview: null,
    writeResult: null,
    scanProgress: null,
    error: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    scanStartedAt: null,
    scanCompletedAt: null,
    writeStartedAt: null,
    writeCompletedAt: null,
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function getVermontImportSession(sessionId: string): VermontImportSession | null {
  return sessions.get(sessionId) ?? null;
}

export function appendVermontImportLog(
  sessionId: string,
  level: VermontImportLogLevel,
  message: string,
  detail?: Record<string, unknown>
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.logs.push({ ts: nowIso(), level, message, detail });
  if (session.logs.length > 500) {
    session.logs.splice(0, session.logs.length - 500);
  }
  session.updatedAt = nowIso();
}

export function patchVermontImportSession(
  sessionId: string,
  patch: Partial<Omit<VermontImportSession, "sessionId" | "logs">>
): VermontImportSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  Object.assign(session, patch, { updatedAt: nowIso() });
  return session;
}
