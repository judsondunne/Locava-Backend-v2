import process from "node:process";
import { achievementCelebrationsService } from "../src/services/surfaces/achievement-celebrations.service.js";

async function main() {
  const userId = String(process.env.DEBUG_USER_ID ?? "").trim();
  const xpDelta = Number(process.env.DEBUG_XP_DELTA ?? "50");
  const previousXp = Number(process.env.DEBUG_PREV_XP ?? "0");
  const newXp = Number(process.env.DEBUG_NEW_XP ?? String(previousXp + xpDelta));
  if (!userId) {
    throw new Error("Missing DEBUG_USER_ID");
  }

  const celebration = await achievementCelebrationsService.createLeaguePassCelebration({
    userId,
    xpDelta: Number.isFinite(xpDelta) ? Math.max(0, Math.trunc(xpDelta)) : 50,
    previousXp: Number.isFinite(previousXp) ? Math.max(0, Math.trunc(previousXp)) : 0,
    newXp: Number.isFinite(newXp) ? Math.max(0, Math.trunc(newXp)) : 0,
    source: "debug_script",
  });

  const pending = await achievementCelebrationsService.getPendingCelebrations(userId);
  console.log("[debug-league-pass] create result", celebration);
  console.log("[debug-league-pass] pending celebrations", pending);

  if (celebration?.celebrationId) {
    const consumed = await achievementCelebrationsService.consumeCelebration(userId, celebration.celebrationId);
    console.log("[debug-league-pass] consumed", consumed);
  }
}

main().catch((error) => {
  console.error("[debug-league-pass] failed", error);
  process.exit(1);
});
