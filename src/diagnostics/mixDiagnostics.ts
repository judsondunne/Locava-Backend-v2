export type MixDiagnostics = {
  mixId: string;
  scoringVersion: string;
  candidateCount?: number;
  notes?: string[];
};

export function buildMixDiagnostics(input: MixDiagnostics): Record<string, unknown> {
  return {
    mixId: input.mixId,
    scoringVersion: input.scoringVersion,
    candidateCount: input.candidateCount,
    notes: input.notes ?? [],
  };
}

