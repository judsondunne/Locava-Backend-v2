export function hasRealAssetLocation(input: {
  assetLatitude: number | null;
  assetLongitude: number | null;
}): boolean {
  const lat = input.assetLatitude;
  const lon = input.assetLongitude;
  return lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
}
