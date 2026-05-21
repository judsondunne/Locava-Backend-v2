/**
 * Optional USD estimates from env (per 1M tokens). Missing vars → no estimate.
 * Example: WIKI_GEMINI_25_FLASH_INPUT_PER_1M_USD=0.30 WIKI_GEMINI_25_FLASH_OUTPUT_PER_1M_USD=2.50
 */
export function estimateGeminiCostUsd(input: {
  model: string;
  promptTokens?: number;
  outputTokens?: number;
}): { estimatedCostUsd?: number; pricingSource: "config" | "unknown" } {
  const m = String(input.model || "").toLowerCase();
  const pick = (suffix: string): string | undefined => {
    const specific = process.env[`WIKI_GEMINI_PRICE_${suffix}`]?.trim();
    if (specific) return specific;
    if (m.includes("2.5-flash") && !m.includes("lite")) {
      return process.env[`WIKI_GEMINI_25_FLASH_${suffix}`]?.trim();
    }
    return process.env[`WIKI_GEMINI_DEFAULT_${suffix}`]?.trim();
  };
  const inPerM = pick("INPUT_PER_1M_USD");
  const outPerM = pick("OUTPUT_PER_1M_USD");
  const pi = inPerM ? Number(inPerM) : NaN;
  const po = outPerM ? Number(outPerM) : NaN;
  if (!Number.isFinite(pi) || !Number.isFinite(po)) {
    return { pricingSource: "unknown" };
  }
  const pt = input.promptTokens ?? 0;
  const ct = input.outputTokens ?? 0;
  if (pt <= 0 && ct <= 0) return { pricingSource: "unknown" };
  const usd = (pt / 1_000_000) * pi + (ct / 1_000_000) * po;
  return { estimatedCostUsd: Math.round(usd * 1_000_000) / 1_000_000, pricingSource: "config" };
}
