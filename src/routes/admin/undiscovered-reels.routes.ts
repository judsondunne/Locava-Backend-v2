import type { FastifyInstance } from "fastify";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import type { CollectedReelInput } from "../../contracts/surfaces/undiscovered-reels.contract.js";
import {
  FetchBySpotsBodySchema,
  GeolocateReelsBodySchema,
  UndiscoveredReelSchema,
} from "../../contracts/surfaces/undiscovered-reels.contract.js";
import { runReelGeolocation } from "../../lib/undiscovered/reels/runReelGeolocation.js";
import type { SpotCandidate } from "../../lib/undiscovered/reels/matchReelToSpot.js";
import { extractInstagramOwner } from "../../lib/undiscovered/reels/extractInstagramOwner.js";
import { fetchReelsForSpot } from "../../lib/undiscovered/reels/fetchReelsByHashtag.js";
import { fetchInstagramMediaOwner } from "../../lib/instagram-reel/instagramGraphqlResolve.js";
import { geminiGenerateContentJson } from "../../admin/wikiCuration/geminiGenerateContent.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

type FirestoreDb = NonNullable<ReturnType<typeof getFirestoreSourceClient>>;

/** Gemini key from the shell/.env — accepts any of the repo's Gemini key vars. */
function geminiApiKey(): string {
  for (const name of ["GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "PHOTOQA_GEMINI_API_KEY", "PBF_ASSET_GEMINI_API_KEY"]) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

/** Firestore-backed spot-candidate loader (prefix query on displayName, both collections). */
function makeLoadSpotCandidates(db: FirestoreDb | null) {
  const cache = new Map<string, SpotCandidate[]>();
  return async (extractedName: string): Promise<SpotCandidate[]> => {
    if (!db) return [];
    const token = extractedName.trim().split(/\s+/)[0];
    if (!token || token.length < 2) return [];
    const cacheKey = token.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const out: SpotCandidate[] = [];
    for (const collection of ["unexploredSpots", "unexploredRoutes"] as const) {
      try {
        const snap = await db
          .collection(collection)
          .orderBy("displayName")
          .startAt(token)
          .endAt(`${token}`)
          .limit(30)
          .get();
        for (const doc of snap.docs) {
          const d = doc.data() as Record<string, unknown>;
          const lat = Number(d.lat ?? (d.location as { lat?: number })?.lat);
          const lng = Number(d.lng ?? (d.location as { lng?: number })?.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            out.push({ id: doc.id, collection, displayName: String(d.displayName ?? ""), lat, lng });
          }
        }
      } catch {
        // best-effort
      }
    }
    cache.set(cacheKey, out);
    return out;
  };
}

/** Run the geolocation pipeline over reels and optionally persist to undiscoveredReels. */
async function geolocateAndWrite(
  reels: CollectedReelInput[],
  opts: { region: string; apiKey: string; db: FirestoreDb | null; cookieHeader?: string; resolveCreators: boolean; write: boolean },
) {
  const summary = await runReelGeolocation(reels, opts.region, {
    apiKey: opts.apiKey,
    model: process.env.UNDISCOVERED_REELS_GEMINI_MODEL?.trim() || "gemini-flash-latest",
    geminiCaller: geminiGenerateContentJson,
    loadSpotCandidates: makeLoadSpotCandidates(opts.db),
    fetchCreator: async (reel) => {
      if (reel.ownerRaw) return extractInstagramOwner(reel.ownerRaw);
      if (!opts.resolveCreators) return null;
      const owner = await fetchInstagramMediaOwner(reel.shortcode, { extraCookieHeader: opts.cookieHeader });
      return owner ? extractInstagramOwner({ owner }) : null;
    },
  });
  let written = 0;
  if (opts.write && opts.db) {
    for (const record of summary.records) {
      try {
        UndiscoveredReelSchema.parse(record);
        await opts.db.collection("undiscoveredReels").doc(record.id).set(record, { merge: true });
        written += 1;
      } catch {
        // skip a malformed record rather than fail the batch
      }
    }
  }
  return { counts: summary.counts, written, records: summary.records };
}

/**
 * Undiscovered Reels — turn collected IG reels into geolocated, attributed
 * records in the `undiscoveredReels` collection. Reuses the resolver/downloader
 * upstream; this is the AI-location + attribution + write step.
 */
export async function registerUndiscoveredReelsRoutes(app: FastifyInstance): Promise<void> {
  const base = "/admin/undiscovered/api/reels";

  app.get(`${base}/health`, async () => {
    setRouteName("admin.undiscovered.reels.health");
    const geminiKey = geminiApiKey();
    return success({
      ok: true,
      geminiConfigured: Boolean(geminiKey),
      firestoreEnabled: Boolean(getFirestoreSourceClient()),
      collection: "undiscoveredReels",
    });
  });

  // Process already-collected reels (pasted JSON from the extension/downloader).
  app.post(`${base}/geolocate`, async (request, reply) => {
    setRouteName("admin.undiscovered.reels.geolocate");
    const body = GeolocateReelsBodySchema.parse(request.body ?? {});
    const apiKey = geminiApiKey();
    if (!apiKey) {
      return reply.status(400).send(failure("gemini_key_missing", "Set a Gemini API key in .env for AI location extraction."));
    }
    const result = await geolocateAndWrite(body.reels, {
      region: body.region,
      apiKey,
      db: getFirestoreSourceClient(),
      cookieHeader: body.instagramCookieHeader,
      resolveCreators: body.resolveCreators,
      write: body.write,
    });
    return success({ ...result, wrote: body.write, records: result.records.slice(0, 50) });
  });

  // Automatic acquisition: fetch reels from Instagram by spot name (hashtag
  // scraping — needs a session cookie), then geolocate + attribute + write.
  app.post(`${base}/fetch-by-spots`, async (request, reply) => {
    setRouteName("admin.undiscovered.reels.fetch_by_spots");
    const body = FetchBySpotsBodySchema.parse(request.body ?? {});
    const apiKey = geminiApiKey();
    if (!apiKey) {
      return reply.status(400).send(failure("gemini_key_missing", "Set a Gemini API key in .env for AI location extraction."));
    }
    const db = getFirestoreSourceClient();

    // Resolve which spots to hunt reels for: explicit list, else top-N by name.
    let spotNames = body.spotNames ?? [];
    if (spotNames.length === 0 && db) {
      try {
        const snap = await db.collection("unexploredSpots").orderBy("displayName").limit(body.topN).get();
        spotNames = snap.docs.map((d) => String((d.data() as { displayName?: string }).displayName ?? "")).filter(Boolean);
      } catch {
        // fall through with empty — caller can pass spotNames explicitly
      }
    }
    if (spotNames.length === 0) {
      return reply.status(400).send(failure("no_spots", "Provide spotNames, or ensure unexploredSpots is populated."));
    }

    // Fetch caption-filtered reels per spot from IG hashtag pages, dedupe by shortcode.
    const perSpot: Record<string, number> = {};
    const allReels: CollectedReelInput[] = [];
    const seen = new Set<string>();
    for (const name of spotNames) {
      const reels = await fetchReelsForSpot(name, { cookieHeader: body.instagramCookieHeader });
      perSpot[name] = reels.length;
      for (const r of reels) {
        if (seen.has(r.shortcode)) continue;
        seen.add(r.shortcode);
        allReels.push(r);
      }
    }

    if (allReels.length === 0) {
      return success({
        spotsSearched: spotNames.length,
        reelsFound: 0,
        perSpot,
        note: body.instagramCookieHeader
          ? "No reels returned — Instagram may be rate-limiting, or no reels mention these spots yet."
          : "No reels returned — Instagram hashtag pages need a logged-in session cookie to respond from a server.",
      });
    }

    const result = await geolocateAndWrite(allReels.slice(0, 200), {
      region: body.region,
      apiKey,
      db,
      cookieHeader: body.instagramCookieHeader,
      resolveCreators: true,
      write: body.write,
    });
    return success({
      spotsSearched: spotNames.length,
      reelsFound: allReels.length,
      perSpot,
      ...result,
      wrote: body.write,
      records: result.records.slice(0, 50),
    });
  });
}
