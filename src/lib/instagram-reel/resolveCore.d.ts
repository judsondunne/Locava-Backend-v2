export type InstagramReelHttpResult =
  | { kind: "json"; status: number; contentType: string; body: string }
  | { kind: "binary"; status: number; body: Buffer; headers: Record<string, string> };

export function instagramReelProbe(): Promise<InstagramReelHttpResult>;
export function resolveInstagramReel(
  body: unknown,
  ctx?: { debug?: boolean; userAgent?: string },
): Promise<InstagramReelHttpResult>;
