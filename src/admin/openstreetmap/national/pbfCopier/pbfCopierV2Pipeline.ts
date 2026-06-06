/**
 * Shared PBF Copier V2 post-scan pipeline — used by bbox preview and full-file runs.
 */
import {
  applyPbfQualityFilters,
  DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
  type PbfQualityFilterResult,
  type PbfQualityFilterSettings,
} from "./pbfCopierV2QualityFilters.js";
import { enrichUnnamedOutdoorDisplayNames } from "./pbfCopierV2GeneratedDisplayNames.js";
import type { PbfCopierPreviewDoc } from "./pbfCopierTypes.js";

export type RunPbfCopierV2PipelineInput = {
  rawItems: PbfCopierPreviewDoc[];
  qualitySettings?: PbfQualityFilterSettings;
};

/** Classify/filter/group/rescue — same path as bbox preview after raw scan. */
export function runPbfCopierV2Pipeline(
  input: RunPbfCopierV2PipelineInput
): PbfQualityFilterResult {
  const settings: PbfQualityFilterSettings = {
    ...DEFAULT_PBF_QUALITY_FILTER_SETTINGS,
    ...(input.qualitySettings ?? {}),
    hideUnnamedPaths: false,
  };
  const withGeneratedNames = enrichUnnamedOutdoorDisplayNames(input.rawItems);
  return applyPbfQualityFilters(withGeneratedNames, settings);
}
