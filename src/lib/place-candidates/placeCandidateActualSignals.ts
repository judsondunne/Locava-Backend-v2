import type { PlaceCandidate } from "./types.js";

const CEMETERY_PATTERNS = [/\bcemetery\b/i, /\bgraveyard\b/i, /\bburial ground\b/i, /\bmemorial park\b/i];
const LIBRARY_PATTERNS = [/\blibrary\b/i];
const MEMORIAL_ONLY_PATTERNS = [/\bmemorial\b/i];
const ADMIN_PATTERNS = [
  /\bcity hall\b/i,
  /\btown hall\b/i,
  /\bcourthouse\b/i,
  /\blaw office\b/i,
  /\badministrative\b/i,
];
const HOUSE_PATTERNS = [/\bresidence\b/i, /\bprivate house\b/i, /\bhome\b/i];

export function actualLabelBlob(candidate: PlaceCandidate): string {
  const actual = candidate.debug.actualTypeLabels ?? [];
  return [candidate.name, ...actual].join(" ").toLowerCase();
}

export function detectActualNegativeSignals(candidate: PlaceCandidate): string[] {
  const blob = actualLabelBlob(candidate);
  const signals: string[] = [];
  if (CEMETERY_PATTERNS.some((pattern) => pattern.test(blob))) signals.push("cemetery");
  if (LIBRARY_PATTERNS.some((pattern) => pattern.test(blob))) signals.push("library");
  if (MEMORIAL_ONLY_PATTERNS.some((pattern) => pattern.test(blob))) signals.push("memorial");
  if (ADMIN_PATTERNS.some((pattern) => pattern.test(blob))) signals.push("administrative");
  if (HOUSE_PATTERNS.some((pattern) => pattern.test(blob))) signals.push("house");
  return signals;
}

export function hasActualCemeterySignal(candidate: PlaceCandidate): boolean {
  return detectActualNegativeSignals(candidate).includes("cemetery");
}

export function hasActualLowValueSignal(candidate: PlaceCandidate): boolean {
  const signals = detectActualNegativeSignals(candidate);
  return signals.length > 0;
}
