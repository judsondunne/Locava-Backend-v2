import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type PersistedUploadSessionState = "open" | "finalized" | "expired";
export type PersistedPostingOperationState = "processing" | "completed" | "failed" | "cancelled";
export type PersistedPostingTerminalReason =
  | "processing"
  | "ready"
  | "failed"
  | "cancelled_by_user"
  | "retry_requested";

export type PersistedPostingMediaState = "registered" | "uploaded" | "ready" | "failed";

export type PersistedUploadSessionRecord = {
  sessionId: string;
  viewerId: string;
  clientSessionKey: string;
  mediaCountHint: number;
  createdAtMs: number;
  expiresAtMs: number;
  state: PersistedUploadSessionState;
};

export type PersistedPostingOperationRecord = {
  operationId: string;
  viewerId: string;
  sessionId: string;
  postId: string;
  idempotencyKey: string;
  createdAtMs: number;
  updatedAtMs: number;
  state: PersistedPostingOperationState;
  pollCount: number;
  pollAfterMs: number;
  terminalReason: PersistedPostingTerminalReason;
  retryCount: number;
  completionInvalidatedAtMs: number | null;
};

export type PersistedPostingMediaRecord = {
  mediaId: string;
  viewerId: string;
  sessionId: string;
  assetIndex: number;
  assetType: "photo" | "video";
  expectedObjectKey: string;
  state: PersistedPostingMediaState;
  createdAtMs: number;
  updatedAtMs: number;
  uploadedAtMs: number | null;
  readyAtMs: number | null;
  pollCount: number;
  pollAfterMs: number;
  failureReason: string | null;
  clientMediaKey: string | null;
};

type PersistedPostingStateV2 = {
  version: 2;
  sessionsById: Record<string, PersistedUploadSessionRecord>;
  sessionsByViewerKey: Record<string, string>;
  operationsById: Record<string, PersistedPostingOperationRecord>;
  operationsByViewerIdempotency: Record<string, string>;
  mediaById: Record<string, PersistedPostingMediaRecord>;
  mediaByViewerSessionIndex: Record<string, string>;
  mediaByViewerClientKey: Record<string, string>;
};

const EMPTY_STATE: PersistedPostingStateV2 = {
  version: 2,
  sessionsById: {},
  sessionsByViewerKey: {},
  operationsById: {},
  operationsByViewerIdempotency: {},
  mediaById: {},
  mediaByViewerSessionIndex: {},
  mediaByViewerClientKey: {}
};

export class PostingStatePersistence {
  private readonly filePath: string;
  private loaded = false;
  private state: PersistedPostingStateV2 = EMPTY_STATE;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(filePath = join(process.cwd(), "state", "posting-mutations-state.json")) {
    this.filePath = filePath;
  }

  async getState(): Promise<PersistedPostingStateV2> {
    await this.ensureLoaded();
    return this.state;
  }

  async mutate(mutator: (draft: PersistedPostingStateV2) => void): Promise<PersistedPostingStateV2> {
    await this.ensureLoaded();
    mutator(this.state);
    await this.persist();
    return this.state;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        version?: number;
        sessionsById?: Record<string, PersistedUploadSessionRecord>;
        sessionsByViewerKey?: Record<string, string>;
        operationsById?: Record<string, PersistedPostingOperationRecord>;
        operationsByViewerIdempotency?: Record<string, string>;
        mediaById?: Record<string, PersistedPostingMediaRecord>;
        mediaByViewerSessionIndex?: Record<string, string>;
        mediaByViewerClientKey?: Record<string, string>;
      };
      if (parsed.version === 2 || parsed.version === 1) {
        this.state = {
          version: 2,
          sessionsById: parsed.sessionsById ?? {},
          sessionsByViewerKey: parsed.sessionsByViewerKey ?? {},
          operationsById: parsed.operationsById ?? {},
          operationsByViewerIdempotency: parsed.operationsByViewerIdempotency ?? {},
          mediaById: parsed.mediaById ?? {},
          mediaByViewerSessionIndex: parsed.mediaByViewerSessionIndex ?? {},
          mediaByViewerClientKey: parsed.mediaByViewerClientKey ?? {}
        };
      } else {
        this.state = { ...EMPTY_STATE };
      }
    } catch {
      this.state = { ...EMPTY_STATE };
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(this.state);
    const dir = dirname(this.filePath);
    this.writeTail = this.writeTail.then(async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(this.filePath, payload, "utf8");
    });
    await this.writeTail;
  }
}

export const postingStatePersistence = new PostingStatePersistence();
