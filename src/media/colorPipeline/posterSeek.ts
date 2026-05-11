/** Stable poster frame time: 1.25s when long enough, else 20% into clip (never 0). */
export function posterSeekSeconds(durationSec: number): number {
  if (!(durationSec > 0)) return 0.05;
  if (durationSec >= 1.25) return 1.25;
  return Math.max(0.05, durationSec * 0.2);
}
