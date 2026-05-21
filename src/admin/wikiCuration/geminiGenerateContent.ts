/**
 * Google Gemini (Generative Language API) — used by wiki spot curation dry-review.
 * @see https://ai.google.dev/api/rest/v1beta/models/generateContent
 */

export type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type GeminiGenerateContentResult = {
  text: string;
  httpStatus: number;
  /** Raw API error payload when request fails */
  errorDetail?: string;
  usage?: GeminiUsageMetadata;
};

export async function geminiGenerateContentJson(input: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userText: string;
  temperature?: number;
}): Promise<GeminiGenerateContentResult> {
  const modelId = String(input.model || "gemini-2.5-flash").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: input.userText }] }],
      generationConfig: {
        temperature: input.temperature ?? 0.35,
        responseMimeType: "application/json"
      }
    })
  });

  const rawText = await res.text();
  if (!res.ok) {
    return { text: "", httpStatus: res.status, errorDetail: rawText.slice(0, 1200) };
  }

  let data: {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
    error?: { code?: number; message?: string; status?: string };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    return { text: "", httpStatus: res.status, errorDetail: "response_not_json" };
  }

  if (data.error?.message) {
    return { text: "", httpStatus: res.status, errorDetail: data.error.message };
  }

  const block = data.promptFeedback?.blockReason;
  if (block) {
    const msg = data.promptFeedback?.blockReasonMessage || block;
    return { text: "", httpStatus: res.status, errorDetail: `prompt_blocked: ${msg}` };
  }

  const parts = data.candidates?.[0]?.content?.parts;
  const text = (parts || []).map((p) => String(p?.text || "")).join("").trim();

  const um = data.usageMetadata;
  const usage: GeminiUsageMetadata | undefined =
    um && (um.promptTokenCount != null || um.candidatesTokenCount != null || um.totalTokenCount != null)
      ? {
          promptTokenCount: um.promptTokenCount,
          candidatesTokenCount: um.candidatesTokenCount,
          totalTokenCount: um.totalTokenCount
        }
      : undefined;

  return { text, httpStatus: res.status, usage };
}
