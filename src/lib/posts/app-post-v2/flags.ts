/** Env `BACKEND_APP_POST_V2_RESPONSES` — default on; set `0` or `false` to omit `appPost` payloads. */
export function isBackendAppPostV2ResponsesEnabled(): boolean {
  const v = process.env.BACKEND_APP_POST_V2_RESPONSES;
  if (v === "0" || v === "false") return false;
  return true;
}
