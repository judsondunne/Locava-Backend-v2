import { createApp } from "../src/app/createApp.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readFlag(name: string): string | null {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim() || null;
  const index = process.argv.indexOf(name);
  if (index >= 0) {
    const next = process.argv[index + 1];
    if (next && !next.startsWith("--")) return next.trim();
  }
  return null;
}

const viewerId =
  readFlag("--viewerId") ||
  process.env.LOCAVA_VIEWER_ID?.trim() ||
  process.env.DEBUG_VIEWER_ID?.trim() ||
  "aXngoh9jeqW35FNM3fq1w9aXdEh1";
const strict = process.argv.includes("--strict");
const json = process.argv.includes("--json") || !strict;
const allowProductionMutation = process.argv.includes("--allow-production-mutation");
const here = path.dirname(fileURLToPath(import.meta.url));
const legacyBackendRoot = path.resolve(here, "../../Locava Backend");
const originalCwd = process.cwd();

process.chdir(legacyBackendRoot);
const legacyAchievementsModule = await import("../../Locava Backend/src/services/achievements.service.ts");
const legacyRulesModule = await import("../../Locava Backend/src/services/achievementsRules.service.ts");
const legacyLeaderboardModule = await import("../../Locava Backend/src/services/achievementsLeaderboard.service.ts");
process.chdir(originalCwd);

const legacyAchievementsService =
  (legacyAchievementsModule as Record<string, any>).achievementsService ??
  (legacyAchievementsModule as Record<string, any>).default?.achievementsService;
const achievementsRulesService =
  (legacyRulesModule as Record<string, any>).achievementsRulesService ??
  (legacyRulesModule as Record<string, any>).default?.achievementsRulesService;
const achievementsLeaderboardService =
  (legacyLeaderboardModule as Record<string, any>).achievementsLeaderboardService ??
  (legacyLeaderboardModule as Record<string, any>).default?.achievementsLeaderboardService;

if (!legacyAchievementsService || !achievementsRulesService || !achievementsLeaderboardService) {
  throw new Error("legacy_achievements_services_unavailable");
}

const app = createApp({ LOG_LEVEL: "silent" });
const headers = { "x-viewer-id": viewerId, "x-viewer-roles": "internal" };

try {
  const [v2BootstrapRes, v2ClaimablesRes, v2XpLbRes, oldHero, oldStatus, oldBadges, oldXpLb] = await Promise.all([
    app.inject({ method: "GET", url: "/v2/achievements/bootstrap", headers }),
    app.inject({ method: "GET", url: "/v2/achievements/claimables", headers }),
    app.inject({ method: "GET", url: "/v2/achievements/leaderboard/xp_global", headers }),
    legacyAchievementsService.getHero(viewerId),
    legacyAchievementsService.getStatus(viewerId),
    achievementsRulesService.getAllBadgesWithProgress(viewerId),
    achievementsLeaderboardService.getGlobalXPLeaderboard(viewerId, 20)
  ]);

  const v2Bootstrap = (v2BootstrapRes.json() as any).data;
  const v2Claimables = (v2ClaimablesRes.json() as any).data;
  const v2XpLb = (v2XpLbRes.json() as any).data;

  const oldBadgeRows = Array.isArray(oldBadges.badges) ? oldBadges.badges : [];
  const v2BadgeRows = Array.isArray(v2Bootstrap?.snapshot?.badges) ? v2Bootstrap.snapshot.badges : [];
  const v2StaticBadgeRows = v2BadgeRows.filter((badge: any) => badge?.badgeSource !== "competitive");
  const v2CompetitiveBadgeRows = v2BadgeRows.filter((badge: any) => badge?.badgeSource === "competitive");

  const oldBadgeIds = new Set<string>(oldBadgeRows.map((badge: any) => String(badge?.id ?? "").trim()).filter(Boolean));
  const v2StaticBadgeIds = new Set<string>(v2StaticBadgeRows.map((badge: any) => String(badge?.id ?? "").trim()).filter(Boolean));
  const badgeIdsMissingFromV2 = [...oldBadgeIds].filter((id) => !v2StaticBadgeIds.has(id)).sort();
  const badgeIdsExtraInV2 = [...v2StaticBadgeIds].filter((id) => !oldBadgeIds.has(id)).sort();

  const oldClaimable = {
    weeklyCaptures: Array.isArray(oldStatus.data?.weeklyCaptures)
      ? oldStatus.data.weeklyCaptures.filter((capture: any) => capture?.completed && !capture?.claimed).length
      : null,
    challenges: Array.isArray(oldStatus.data?.challenges)
      ? oldStatus.data.challenges.filter((challenge: any) => challenge?.completed && !challenge?.claimed).length
      : null,
    badges: oldBadgeRows.filter((badge: any) => badge?.userProgress?.earned && !badge?.userProgress?.claimed).length
  };
  const v2Claimable = {
    weeklyCaptures: Array.isArray(v2Claimables?.claimables?.weeklyCaptures) ? v2Claimables.claimables.weeklyCaptures.length : null,
    challenges: Array.isArray(v2Claimables?.claimables?.challenges) ? v2Claimables.claimables.challenges.length : null,
    badges: Array.isArray(v2Claimables?.claimables?.badges)
      ? v2Claimables.claimables.badges.filter((badge: any) => badge?.source !== "competitive").length
      : null,
    competitiveBadges: Array.isArray(v2Claimables?.claimables?.badges)
      ? v2Claimables.claimables.badges.filter((badge: any) => badge?.source === "competitive").length
      : null
  };

  const acceptedDifferences: string[] = [];
  if (v2CompetitiveBadgeRows.length > 0) {
    acceptedDifferences.push(
      "v2 bootstrap carries competitive badges alongside the static badge list; strict badge parity compares only static badge ids/counts"
    );
  }

  const comparison = {
    viewerId,
    strict,
    allowProductionMutation,
    bootstrap: {
      oldXp: oldHero.data?.xp?.current ?? null,
      v2Xp: v2Bootstrap?.hero?.xp?.current ?? null,
      oldLevel: oldHero.data?.xp?.level ?? null,
      v2Level: v2Bootstrap?.hero?.xp?.level ?? null,
      oldStreak: oldHero.data?.streak?.current ?? null,
      v2Streak: v2Bootstrap?.hero?.streak?.current ?? null,
      oldTotalPosts: oldHero.data?.totalPosts ?? null,
      v2TotalPosts: v2Bootstrap?.hero?.totalPosts ?? null,
      oldLeague: oldHero.data?.currentLeague?.name ?? oldHero.data?.xp?.tier ?? null,
      v2League: v2Bootstrap?.hero?.xp?.tier ?? null
    },
    status: {
      oldChallenges: oldStatus.data?.challenges?.length ?? null,
      v2Challenges: v2Bootstrap?.snapshot?.challenges?.length ?? null,
      oldWeeklyCaptures: oldStatus.data?.weeklyCaptures?.length ?? null,
      v2WeeklyCaptures: v2Bootstrap?.snapshot?.weeklyCaptures?.length ?? null
    },
    badges: {
      oldBadgeCount: oldBadgeRows.length,
      v2StaticBadgeCount: v2StaticBadgeRows.length,
      v2CompetitiveBadgeCount: v2CompetitiveBadgeRows.length,
      badgeIdsMissingFromV2,
      badgeIdsExtraInV2,
      oldTopBadges: oldBadgeRows.slice(0, 5).map((badge: any) => badge.id),
      v2TopStaticBadges: v2StaticBadgeRows.slice(0, 5).map((badge: any) => badge.id),
      v2TopCompetitiveBadges: v2CompetitiveBadgeRows.slice(0, 5).map((badge: any) => badge.id)
    },
    claimables: {
      old: oldClaimable,
      v2: v2Claimable
    },
    leaderboard: {
      oldViewerRank: oldXpLb.userRank ?? null,
      v2ViewerRank: v2XpLb?.viewerRank ?? null,
      oldTopUser: oldXpLb.leaderboard?.[0]?.userId ?? null,
      v2TopUser: v2XpLb?.leaderboard?.[0]?.userId ?? null
    },
    postCreated: {
      compared: false,
      skippedReason: allowProductionMutation
        ? "dangerous mutation comparison not implemented in this safe parity harness"
        : "skipped without --allow-production-mutation"
    },
    acceptedDifferences
  };

  const parityFailures = [
    comparison.bootstrap.oldXp !== comparison.bootstrap.v2Xp ? "xp_mismatch" : null,
    comparison.bootstrap.oldLevel !== comparison.bootstrap.v2Level ? "level_mismatch" : null,
    comparison.bootstrap.oldStreak !== comparison.bootstrap.v2Streak ? "streak_mismatch" : null,
    comparison.bootstrap.oldTotalPosts !== comparison.bootstrap.v2TotalPosts ? "total_posts_mismatch" : null,
    comparison.badges.oldBadgeCount !== comparison.badges.v2StaticBadgeCount ? "static_badge_count_mismatch" : null,
    comparison.badges.badgeIdsMissingFromV2.length > 0 ? "badge_ids_missing_from_v2" : null,
    comparison.badges.badgeIdsExtraInV2.length > 0 ? "badge_ids_extra_in_v2" : null,
    comparison.claimables.old.weeklyCaptures !== comparison.claimables.v2.weeklyCaptures
      ? "weekly_capture_claimables_mismatch"
      : null,
    comparison.claimables.old.challenges !== comparison.claimables.v2.challenges ? "challenge_claimables_mismatch" : null,
    comparison.claimables.old.badges !== comparison.claimables.v2.badges ? "badge_claimables_mismatch" : null,
    comparison.leaderboard.oldViewerRank !== comparison.leaderboard.v2ViewerRank ? "leaderboard_rank_mismatch" : null,
    comparison.leaderboard.oldTopUser !== comparison.leaderboard.v2TopUser ? "leaderboard_top_user_mismatch" : null
  ].filter(Boolean);

  if (json) {
    console.log(
      JSON.stringify(
        {
          ...comparison,
          parityFailures
        },
        null,
        2
      )
    );
  } else {
    console.log(`viewer id: ${viewerId}`);
    console.log(`strict mode: ${strict ? "on" : "off"}`);
    console.log(`xp: old=${comparison.bootstrap.oldXp} v2=${comparison.bootstrap.v2Xp}`);
    console.log(`level: old=${comparison.bootstrap.oldLevel} v2=${comparison.bootstrap.v2Level}`);
    console.log(`streak: old=${comparison.bootstrap.oldStreak} v2=${comparison.bootstrap.v2Streak}`);
    console.log(`league: old=${comparison.bootstrap.oldLeague} v2=${comparison.bootstrap.v2League}`);
    console.log(`static badges: old=${comparison.badges.oldBadgeCount} v2=${comparison.badges.v2StaticBadgeCount}`);
    console.log(`competitive badges exposed in v2: ${comparison.badges.v2CompetitiveBadgeCount}`);
    console.log(`claimables badges: old=${comparison.claimables.old.badges} v2=${comparison.claimables.v2.badges}`);
    console.log(`leaderboard rank: old=${comparison.leaderboard.oldViewerRank} v2=${comparison.leaderboard.v2ViewerRank}`);
    console.log(`parity failures: ${parityFailures.join(", ") || "none"}`);
  }

  const hadTransportFailure =
    v2BootstrapRes.statusCode !== 200 ||
    v2ClaimablesRes.statusCode !== 200 ||
    v2XpLbRes.statusCode !== 200 ||
    !oldHero.success ||
    !oldStatus.success ||
    !oldBadges.success ||
    !oldXpLb.success;

  if (hadTransportFailure || (strict && parityFailures.length > 0)) {
    process.exitCode = 1;
  }
} finally {
  await app.close();
  process.exit(process.exitCode ?? 0);
}
