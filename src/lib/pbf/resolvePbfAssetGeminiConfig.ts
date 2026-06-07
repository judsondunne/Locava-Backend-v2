import type { AppEnv } from "../../config/env.js";
import { backendV2RepoGeminiApiKey } from "../../config/env.js";
import {
  wikiSpotCurationGeminiApiKey,
  wikiSpotCurationGeminiModel,
} from "../../admin/wikiCuration/wikiCurationEnv.js";

export type PbfAssetGeminiConfig = {
  enabled: boolean;
  apiKey: string | null;
  model: string;
  keySource: string | null;
};

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function resolvePbfAssetGeminiConfig(_env: AppEnv, overrideApiKey?: string | null): PbfAssetGeminiConfig {
  void _env;
  const override = overrideApiKey?.trim() || null;
  if (override) {
    const model =
      process.env.PBF_ASSET_GEMINI_MODEL?.trim() ||
      process.env.PHOTOQA_GEMINI_MODEL?.trim() ||
      wikiSpotCurationGeminiModel();
    return {
      enabled: true,
      apiKey: override,
      model,
      keySource: "request_override",
    };
  }
  const fromProcess = {
    pbf: process.env.PBF_ASSET_GEMINI_API_KEY?.trim() || null,
    photoQa: process.env.PHOTOQA_GEMINI_API_KEY?.trim() || null,
    gemini: process.env.GEMINI_API_KEY?.trim() || null,
    google: process.env.GOOGLE_GEMINI_API_KEY?.trim() || null,
  };
  const fromWiki = wikiSpotCurationGeminiApiKey();
  const fromRepoFiles = backendV2RepoGeminiApiKey();

  const apiKey =
    firstNonEmpty(
      fromProcess.pbf,
      fromProcess.photoQa,
      fromProcess.gemini,
      fromProcess.google,
      fromWiki,
      fromRepoFiles,
    ) ?? null;

  const keySource = fromProcess.pbf
    ? "PBF_ASSET_GEMINI_API_KEY"
    : fromProcess.photoQa
      ? "PHOTOQA_GEMINI_API_KEY"
      : fromProcess.gemini
        ? "GEMINI_API_KEY"
        : fromProcess.google
          ? "GOOGLE_GEMINI_API_KEY"
          : fromWiki
            ? "wiki_process_env"
            : fromRepoFiles
              ? "backend_v2_env_file"
              : null;

  const model =
    process.env.PBF_ASSET_GEMINI_MODEL?.trim() ||
    process.env.PHOTOQA_GEMINI_MODEL?.trim() ||
    wikiSpotCurationGeminiModel();

  return {
    enabled: Boolean(apiKey),
    apiKey,
    model,
    keySource,
  };
}
