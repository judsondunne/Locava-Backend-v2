import { z } from "zod";
import type { PhotoQaSeedPlace, VisionJudgment } from "./types.js";

const VisionJudgmentSchema = z.object({
  placeMatchScore: z.number().min(0).max(5),
  visualQualityScore: z.number().min(0).max(5),
  locavaCoolnessScore: z.number().min(0).max(5),
  wrongPlaceRisk: z.enum(["low", "medium", "high"]),
  visibleSignals: z.array(z.string()),
  concerns: z.array(z.string()),
  shortReason: z.string(),
});

export type VisionMode = "on" | "off" | "manual";

export function resolveVisionMode(requested: "true" | "false" | "auto"): {
  mode: VisionMode;
  apiKey: string | null;
  model: string;
} {
  const apiKey =
    process.env.PHOTOQA_GEMINI_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GEMINI_API_KEY?.trim() ||
    null;
  const model = process.env.PHOTOQA_GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  if (requested === "false") return { mode: "off", apiKey, model };
  if (requested === "true") {
    return { mode: apiKey ? "on" : "manual", apiKey, model };
  }
  return { mode: apiKey ? "on" : "manual", apiKey, model };
}

function buildVisionPrompt(seed: PhotoQaSeedPlace, searchQuery: string): string {
  return [
    "You are a strict QA reviewer for Locava place photo search.",
    `Place: ${seed.placeName}, ${seed.town}, ${seed.state}`,
    `Search query used: ${searchQuery}`,
    `Expected visual signals: ${seed.expectedVisualSignals.join(", ")}`,
    `Wrong-place warnings: ${seed.wrongPlaceWarnings.join(", ")}`,
    "",
    "Does this image likely show the requested place, not just the general category?",
    "Be strict. If it only shows a generic waterfall/bridge/gorge and there is not enough place-specific evidence, score placeMatch no higher than 3.",
    "If it appears to be the wrong state/town/place, score placeMatch 0 or 1.",
    "Do not mark everything as good. If uncertain, mark wrongPlaceRisk medium or high.",
    "",
    "Return JSON only with keys:",
    "placeMatchScore (0-5), visualQualityScore (0-5), locavaCoolnessScore (0-5),",
    "wrongPlaceRisk (low|medium|high), visibleSignals (string[]), concerns (string[]), shortReason (string).",
  ].join("\n");
}

function detectMime(bytes: Uint8Array, contentType: string | null): string {
  if (contentType?.startsWith("image/")) return contentType.split(";")[0]!;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

export async function judgeImageWithVision(input: {
  seed: PhotoQaSeedPlace;
  searchQuery: string;
  bytes: Uint8Array;
  contentType: string | null;
  apiKey: string;
  model: string;
}): Promise<VisionJudgment> {
  const prompt = buildVisionPrompt(input.seed, input.searchQuery);
  const mimeType = detectMime(input.bytes, input.contentType);
  const base64 = Buffer.from(input.bytes).toString("base64");
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
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    return {
      placeMatchScore: 0,
      visualQualityScore: 0,
      locavaCoolnessScore: 0,
      wrongPlaceRisk: "high",
      visibleSignals: [],
      concerns: ["vision_api_error"],
      shortReason: `Vision API failed (${response.status})`,
      automated: false,
      model: input.model,
      error: rawText.slice(0, 500),
    };
  }

  let parsedJson: unknown;
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
    parsedJson = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return {
      placeMatchScore: 0,
      visualQualityScore: 0,
      locavaCoolnessScore: 0,
      wrongPlaceRisk: "high",
      visibleSignals: [],
      concerns: ["vision_parse_error"],
      shortReason: "Could not parse vision model JSON",
      automated: false,
      model: input.model,
      error: "parse_error",
    };
  }

  const validated = VisionJudgmentSchema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      placeMatchScore: 0,
      visualQualityScore: 0,
      locavaCoolnessScore: 0,
      wrongPlaceRisk: "high",
      visibleSignals: [],
      concerns: ["vision_schema_error"],
      shortReason: validated.error.issues[0]?.message ?? "Invalid vision JSON",
      automated: false,
      model: input.model,
      error: "schema_error",
    };
  }

  return {
    ...validated.data,
    automated: true,
    model: input.model,
  };
}

export function manualVisionPlaceholder(reason: string): VisionJudgment {
  return {
    placeMatchScore: 0,
    visualQualityScore: 0,
    locavaCoolnessScore: 0,
    wrongPlaceRisk: "medium",
    visibleSignals: [],
    concerns: ["manual_review_required"],
    shortReason: reason,
    automated: false,
  };
}
