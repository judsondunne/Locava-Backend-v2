import { z } from "zod";
import type { PbfCopierPreviewDoc } from "../../admin/openstreetmap/national/pbfCopier/pbfCopierTypes.js";
import type { PlaceImageResult } from "../../types/places.js";
import type { OsmPhotoQueryResult } from "./buildOsmSpecificPhotoQuery.js";

const ASSET_TYPES = ["photo", "flyer", "graphic", "map", "logo", "screenshot", "other"] as const;
type AssetType = (typeof ASSET_TYPES)[number];

const PbfAssetVisionJudgmentSchema = z.object({
  isRealPlacePhoto: z.boolean(),
  assetType: z.enum(ASSET_TYPES),
  placeMatchScore: z.number().min(0).max(5),
  visualQualityScore: z.number().min(0).max(5),
  wrongPlaceRisk: z.enum(["low", "medium", "high"]),
  reject: z.boolean(),
  rejectReason: z.string().optional().default(""),
  shortReason: z.string(),
});

function normalizeAssetType(raw: unknown, isRealPlacePhoto = false): AssetType {
  const value = String(raw ?? "").toLowerCase();
  if (
    value.includes("photo") ||
    value.includes("photograph") ||
    value.includes("building") ||
    value.includes("exterior") ||
    value.includes("landscape") ||
    value.includes("scenic")
  ) {
    return "photo";
  }
  if (value.includes("flyer") || value.includes("poster") || value.includes("announcement")) return "flyer";
  if (value.includes("graphic") || value.includes("illustration") || value.includes("clipart")) return "graphic";
  if (value.includes("map")) return "map";
  if (value.includes("logo") || value.includes("icon")) return "logo";
  if (value.includes("screenshot") || value.includes("screen")) return "screenshot";
  if (isRealPlacePhoto) return "photo";
  return "other";
}

function normalizeWrongPlaceRisk(raw: unknown): "low" | "medium" | "high" {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("high")) return "high";
  if (value.includes("medium") || value.includes("med")) return "medium";
  return "low";
}

function normalizeGeminiVisionPayload(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    isRealPlacePhoto: Boolean(raw.isRealPlacePhoto),
    assetType: normalizeAssetType(raw.assetType, Boolean(raw.isRealPlacePhoto)),
    placeMatchScore: Number(raw.placeMatchScore ?? 0),
    visualQualityScore: Number(raw.visualQualityScore ?? 0),
    wrongPlaceRisk: normalizeWrongPlaceRisk(raw.wrongPlaceRisk),
    reject: Boolean(raw.reject),
    rejectReason: String(raw.rejectReason ?? ""),
    shortReason: String(raw.shortReason ?? raw.rejectReason ?? "Gemini vision review"),
  };
}

export type PbfAssetVisionJudgment = z.infer<typeof PbfAssetVisionJudgmentSchema> & {
  automated: boolean;
  model?: string;
  error?: string;
};

function detectMime(bytes: Uint8Array, contentType: string | null): string {
  if (contentType?.startsWith("image/")) return contentType.split(";")[0]!;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

const JUDGMENT_CACHE = new Map<string, { at: number; judgment: PbfAssetVisionJudgment }>();
const JUDGMENT_CACHE_TTL_MS = 30 * 60 * 1000;

function judgmentCacheKey(model: string, imageUrl: string): string {
  return `${model}::${imageUrl}`;
}

async function fetchImageBytes(url: string, maxBytes = 700_000): Promise<{
  bytes: Uint8Array;
  contentType: string | null;
} | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_500);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "LocavaPbfAssetPreview/1.0",
        Accept: "image/*,*/*;q=0.8",
        Range: `bytes=0-${maxBytes - 1}`,
      },
    });
    if (!response.ok && response.status !== 206) return null;
    const buf = await response.arrayBuffer();
    if (buf.byteLength === 0) return null;
    return {
      bytes: new Uint8Array(buf),
      contentType: response.headers.get("content-type"),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildVisionPrompt(input: {
  doc: PbfCopierPreviewDoc;
  query: OsmPhotoQueryResult;
  result: PlaceImageResult;
}): string {
  const town =
    input.doc.sourceTagSample?.["addr:city"] ||
    (input.doc.writePayload as { location?: { city?: string } } | undefined)?.location?.city ||
    "";
  return [
    "You are a strict photo curator for Locava undiscovered outdoor/place assets.",
    `Target place: ${input.doc.displayName}`,
    town ? `Town/context: ${town}, Vermont` : "State: Vermont",
    `Search query used: ${input.query.query}`,
    `Image caption: ${input.result.caption || input.result.title || "(none)"}`,
    `Source page: ${input.result.sourceUrl}`,
    `Source domain: ${input.result.sourceName}`,
    "",
    "Goal: pick REAL photographs of this specific place — building exterior, scenic view, trail, landmark, interior only if clearly this venue.",
    "",
    "REJECT (reject=true) if the image is:",
    "- a flyer, poster, event announcement, raffle ticket, newsletter graphic, or designed promo with heavy text",
    "- a logo, map, diagram, screenshot, or clipart",
    "- a generic stock photo with no clear tie to this named place",
    "- clearly the wrong town/state/landmark",
    "",
    "KEEP (reject=false) if it is a real photo that helps a user recognize or want to visit this place.",
    "Be strict about flyers/posters from library or org websites — those are NOT place photos.",
    "",
    "Return JSON only:",
    "{ isRealPlacePhoto, assetType, placeMatchScore (0-5), visualQualityScore (0-5),",
    "wrongPlaceRisk (low|medium|high), reject (boolean), rejectReason (string), shortReason (string) }",
  ].join("\n");
}

export async function judgePbfAssetPhotoWithGemini(input: {
  doc: PbfCopierPreviewDoc;
  query: OsmPhotoQueryResult;
  result: PlaceImageResult;
  apiKey: string;
  model: string;
}): Promise<PbfAssetVisionJudgment> {
  const cacheKey = judgmentCacheKey(input.model, input.result.imageUrl);
  const cached = JUDGMENT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < JUDGMENT_CACHE_TTL_MS) {
    return cached.judgment;
  }

  const fetched = await fetchImageBytes(input.result.imageUrl);
  if (!fetched) {
    return {
      isRealPlacePhoto: false,
      assetType: "other",
      placeMatchScore: 0,
      visualQualityScore: 0,
      wrongPlaceRisk: "high",
      reject: true,
      rejectReason: "image_fetch_failed",
      shortReason: "Could not download image for vision review",
      automated: false,
      error: "fetch_failed",
    };
  }

  const prompt = buildVisionPrompt(input);
  const mimeType = detectMime(fetched.bytes, fetched.contentType);
  const base64 = Buffer.from(fetched.bytes).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.15,
        responseMimeType: "application/json",
      },
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    return {
      isRealPlacePhoto: false,
      assetType: "other",
      placeMatchScore: 0,
      visualQualityScore: 0,
      wrongPlaceRisk: "medium",
      reject: false,
      rejectReason: "vision_api_error",
      shortReason: `Gemini vision failed (${response.status})`,
      automated: false,
      model: input.model,
      error: rawText.slice(0, 400),
    };
  }

  try {
    const envelope = JSON.parse(rawText) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (envelope.candidates?.[0]?.content?.parts ?? [])
      .map((part) => String(part.text || ""))
      .join("")
      .trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text) as Record<
      string,
      unknown
    >;
    const validated = PbfAssetVisionJudgmentSchema.safeParse(normalizeGeminiVisionPayload(parsed));
    if (!validated.success) {
      throw new Error(validated.error.issues[0]?.message ?? "invalid_json");
    }
    const judgment = { ...validated.data, automated: true, model: input.model } as PbfAssetVisionJudgment;
    JUDGMENT_CACHE.set(cacheKey, { at: Date.now(), judgment });
    return judgment;
  } catch (error) {
    return {
      isRealPlacePhoto: false,
      assetType: "other",
      placeMatchScore: 0,
      visualQualityScore: 0,
      wrongPlaceRisk: "medium",
      reject: false,
      rejectReason: "vision_parse_error",
      shortReason: error instanceof Error ? error.message : "Vision parse error",
      automated: false,
      model: input.model,
      error: "parse_error",
    };
  }
}

export function shouldRejectByGeminiJudgment(judgment: PbfAssetVisionJudgment): boolean {
  if (!judgment.automated) return false;
  if (judgment.reject) return true;
  if (!judgment.isRealPlacePhoto) return true;
  if (["flyer", "graphic", "map", "logo", "screenshot"].includes(judgment.assetType)) return true;
  if (judgment.wrongPlaceRisk === "high") return true;
  if (judgment.placeMatchScore <= 1 && judgment.visualQualityScore <= 2) return true;
  if (judgment.placeMatchScore <= 2 && judgment.visualQualityScore <= 1) return true;
  return false;
}

export function deriveAssetMatchConfidenceFromVision(
  judgment: PbfAssetVisionJudgment | undefined,
): "high" | "medium" | "low" | null {
  if (!judgment?.automated) return null;
  if (shouldRejectByGeminiJudgment(judgment)) return "low";
  if (
    judgment.assetType === "photo" &&
    judgment.isRealPlacePhoto &&
    judgment.placeMatchScore >= 4 &&
    judgment.visualQualityScore >= 3 &&
    judgment.wrongPlaceRisk !== "high"
  ) {
    return "high";
  }
  if (judgment.placeMatchScore + judgment.visualQualityScore >= 7 && judgment.wrongPlaceRisk !== "high") {
    return "medium";
  }
  return "low";
}

export function geminiJudgmentBonusScore(judgment: PbfAssetVisionJudgment): number {
  if (!judgment.automated) return 0;
  if (shouldRejectByGeminiJudgment(judgment)) return -100;
  let score = judgment.placeMatchScore * 4 + judgment.visualQualityScore * 3;
  if (judgment.isRealPlacePhoto) score += 8;
  if (judgment.assetType === "photo") score += 6;
  if (judgment.wrongPlaceRisk === "medium") score -= 4;
  return score;
}
