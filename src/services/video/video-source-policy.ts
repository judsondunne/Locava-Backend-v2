/** True when source is 1080-class or higher (shortest side ≥ 1080). Excludes 720p uploads. */
export function shouldGenerate1080Ladder(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return Math.min(width, height) >= 1080;
}
