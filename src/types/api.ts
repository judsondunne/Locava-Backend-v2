export type ResponseMeta = {
  requestId: string;
  latencyMs?: number;
  db?: {
    reads: number;
    writes: number;
    queries: number;
  };
};

export type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: ResponseMeta;
};
