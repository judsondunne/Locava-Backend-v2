import { geminiGenerateContentJson } from "../../../admin/wikiCuration/geminiGenerateContent.js";

/**
 * AI place-name extraction from a reel caption.
 *
 * Reuses the repo's existing Gemini client (the same one wiki-curation uses).
 * The model returns a strict JSON object; the caller then matches the name to a
 * known undiscovered spot or geocodes it. The Gemini call is injectable so the
 * pure parsing/prompt logic is unit-testable without the network.
 */

export type ReelLocationExtraction = {
  placeName: string | null;
  /** Model's coarse coordinate guess — a fallback only, never trusted over a spot match. */
  latGuess: number | null;
  lngGuess: number | null;
  activity: string | null;
  confidence: number;
};

export type GeminiJsonCaller = (input: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userText: string;
  temperature?: number;
}) => Promise<{ text: string; httpStatus: number }>;

const SYSTEM_INSTRUCTION = `You extract the specific outdoor place a short-form video is about, from its caption.
Return STRICT JSON only, matching:
{"placeName": string|null, "lat": number|null, "lng": number|null, "activity": string|null, "confidence": number}
Rules:
- placeName: the single specific named place (e.g. "Warren Falls", "Quechee Gorge"). NOT a town, region, or generic word ("hike", "waterfall"). null if none is clearly named.
- lat/lng: your best coarse guess for that place if you know it, else null. These are only a fallback.
- activity: hiking, swimming, waterfall, camping, paddling, viewpoint, biking, or null.
- confidence: 0..1 that placeName is a real, specific, findable place.
- Region context is Vermont, USA unless the caption clearly says otherwise.`;

function parseExtraction(text: string): ReelLocationExtraction {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFences(text));
  } catch {
    return { placeName: null, latGuess: null, lngGuess: null, activity: null, confidence: 0 };
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.placeName === "string" ? o.placeName.trim() : "";
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const conf = num(o.confidence);
  return {
    placeName: name.length > 1 ? name : null,
    latGuess: num(o.lat),
    lngGuess: num(o.lng),
    activity: typeof o.activity === "string" && o.activity.trim() ? o.activity.trim() : null,
    confidence: conf == null ? 0 : Math.max(0, Math.min(1, conf)),
  };
}

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export async function extractReelLocation(
  caption: string,
  opts: { apiKey: string; model?: string; caller?: GeminiJsonCaller },
): Promise<ReelLocationExtraction> {
  const clean = caption.trim();
  if (clean.length < 3) {
    return { placeName: null, latGuess: null, lngGuess: null, activity: null, confidence: 0 };
  }
  const caller = opts.caller ?? geminiGenerateContentJson;
  const result = await caller({
    apiKey: opts.apiKey,
    model: opts.model ?? "gemini-flash-latest",
    systemInstruction: SYSTEM_INSTRUCTION,
    userText: `Caption:\n"""${clean.slice(0, 1200)}"""`,
    temperature: 0.1,
  });
  if (result.httpStatus < 200 || result.httpStatus >= 300 || !result.text) {
    return { placeName: null, latGuess: null, lngGuess: null, activity: null, confidence: 0 };
  }
  return parseExtraction(result.text);
}

export { parseExtraction };
