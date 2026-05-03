/**
 * Bounded geohash prefix set around a center (shared by search mixes nearby + reels near-me).
 */
function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

export async function geoPrefixesAroundCenter(input: { lat: number; lng: number; precision: number }): Promise<string[]> {
  const { latLngToGeohash } = await import("./latlng-geohash.js");
  const step = 0.06; // ~4 miles latitude; coarse but bounded (matches mixes v2 nearby)
  const deltas = [
    [0, 0],
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
    [step, step],
    [step, -step],
    [-step, step],
    [-step, -step],
  ] as const;
  return uniq(
    deltas.map(([dLat, dLng]) => latLngToGeohash(input.lat + dLat, input.lng + dLng, input.precision)),
  );
}
