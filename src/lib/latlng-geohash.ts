/** Minimal geohash encoder (base32) for post location indexing — precision ~2.4km at 5 chars, ~150m at 7. */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 9): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || precision < 1) return "";
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let geohash = "";

  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  while (geohash.length < precision) {
    if (evenBit) {
      const lngMid = (lngMin + lngMax) / 2;
      if (lng >= lngMid) {
        idx = idx * 2 + 1;
        lngMin = lngMid;
      } else {
        idx = idx * 2;
        lngMax = lngMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (lat >= latMid) {
        idx = idx * 2 + 1;
        latMin = latMid;
      } else {
        idx = idx * 2;
        latMax = latMid;
      }
    }
    evenBit = !evenBit;

    bit += 1;
    if (bit === 5) {
      geohash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return geohash;
}
