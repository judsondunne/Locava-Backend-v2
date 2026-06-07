import {
  PlaceImageSearchErrorSchema,
  PlaceImageSearchSuccessSchema,
  type PlaceImageApiResult,
} from "./types.js";

export type SearchImagesApiResponse = {
  ok: true;
  placeName: string;
  searchQuery?: string;
  results: PlaceImageApiResult[];
  source: "bing" | "serper" | "mock";
  httpStatus: number;
  responseMs: number;
  ttfbMs: number | null;
};

export type SearchImagesApiFailure = {
  ok: false;
  httpStatus: number;
  responseMs: number;
  ttfbMs: number | null;
  error: string;
  code?: string;
};

export type SearchImagesApiResult = SearchImagesApiResponse | SearchImagesApiFailure;

const DEFAULT_TARGETS = {
  local: "http://127.0.0.1:8080",
  staging:
    process.env.PHOTOQA_STAGING_BASE_URL?.trim() ||
    process.env.LOCAVA_BACKEND_STAGING_BASE?.trim() ||
    "",
  production:
    process.env.PHOTOQA_PRODUCTION_BASE_URL?.trim() ||
    process.env.PHOTOQA_BASE_URL?.trim() ||
    "https://locava-backend-v2-nboawyiasq-uc.a.run.app",
};

export function resolveBaseUrl(target: "local" | "staging" | "production"): string {
  const override = process.env.PHOTOQA_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");

  const url = DEFAULT_TARGETS[target];
  if (!url) {
    throw new Error(
      `No base URL configured for target=${target}. Set PHOTOQA_BASE_URL or PHOTOQA_${target.toUpperCase()}_BASE_URL.`,
    );
  }
  return url.replace(/\/$/, "");
}

export async function searchPlaceImagesApi(
  baseUrl: string,
  placeQuery: string,
): Promise<SearchImagesApiResult> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/places/search-images`;
  const started = performance.now();
  let ttfbMs: number | null = null;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "LocavaPhotoSearchQA/1.0",
    },
    body: JSON.stringify({ placeName: placeQuery }),
  });

  ttfbMs = Math.round(performance.now() - started);
  const responseMs = Math.round(performance.now() - started);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errParsed = PlaceImageSearchErrorSchema.safeParse(payload);
    let error = errParsed.success ? errParsed.data.error : `HTTP ${response.status}`;
    if (response.status === 404 && payload && typeof payload === "object") {
      const envelope = payload as { error?: { message?: string; code?: string }; message?: string };
      const routeMissing =
        envelope.error?.code === "not_found" ||
        envelope.error?.message?.includes("Route not found") ||
        envelope.message?.includes("Route not found");
      if (routeMissing) {
        error = "Route not found on target server — deploy Backendv2 with /api/places/search-images before production QA.";
      }
    }
    return {
      ok: false,
      httpStatus: response.status,
      responseMs,
      ttfbMs,
      error,
      code: errParsed.success ? errParsed.data.code : undefined,
    };
  }

  const parsed = PlaceImageSearchSuccessSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      httpStatus: response.status,
      responseMs,
      ttfbMs,
      error: `Response schema invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      code: "SCHEMA_ERROR",
    };
  }

  return {
    ok: true,
    ...parsed.data,
    httpStatus: response.status,
    responseMs,
    ttfbMs,
  };
}
