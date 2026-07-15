import type { FastifyInstance } from "fastify";
import { failure, success } from "../../lib/response.js";
import { setRouteName } from "../../observability/request-context.js";
import {
  GeolocateReelsBodySchema,
  UndiscoveredReelSchema,
} from "../../contracts/surfaces/undiscovered-reels.contract.js";
import { runReelGeolocation } from "../../lib/undiscovered/reels/runReelGeolocation.js";
import type { SpotCandidate } from "../../lib/undiscovered/reels/matchReelToSpot.js";
import { extractInstagramOwner } from "../../lib/undiscovered/reels/extractInstagramOwner.js";
import { geminiGenerateContentJson } from "../../admin/wikiCuration/geminiGenerateContent.js";
import { getFirestoreSourceClient } from "../../repositories/source-of-truth/firestore-client.js";

/** Gemini key from the shell/.env — accepts any of the repo's Gemini key vars. */
function geminiApiKey(): string {
  for (const name of ["GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "PHOTOQA_GEMINI_API_KEY", "PBF_ASSET_GEMINI_API_KEY"]) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
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

  app.post(`${base}/geolocate`, async (request, reply) => {
    setRouteName("admin.undiscovered.reels.geolocate");
    const body = GeolocateReelsBodySchema.parse(request.body ?? {});
    const apiKey = geminiApiKey();
    if (!apiKey) {
      return reply
        .status(400)
        .send(failure("gemini_key_missing", "Set GEMINI_API_KEY (or GOOGLE_GEMINI_API_KEY) in .env for AI location extraction."));
    }
    const db = getFirestoreSourceClient();

    // Cheap Firestore-backed candidate loader: prefix query on displayName by the
    // first significant token of the extracted name, across both collections.
    const candidateCache = new Map<string, SpotCandidate[]>();
    const loadSpotCandidates = async (extractedName: string): Promise<SpotCandidate[]> => {
      if (!db) return [];
      const token = extractedName.trim().split(/\s+/)[0];
      if (!token || token.length < 2) return [];
      const cacheKey = token.toLowerCase();
      const cached = candidateCache.get(cacheKey);
      if (cached) return cached;
      const out: SpotCandidate[] = [];
      for (const collection of ["unexploredSpots", "unexploredRoutes"] as const) {
        try {
          const snap = await db
            .collection(collection)
            .orderBy("displayName")
            .startAt(token)
            .endAt(`${token}`)
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
          // prefix query best-effort — a missing index or empty collection just yields fewer candidates
        }
      }
      candidateCache.set(cacheKey, out);
      return out;
    };

    const summary = await runReelGeolocation(body.reels, body.region, {
      apiKey,
      // gemini-flash-latest auto-tracks the current flash model (the pinned 2.5
      // id is retired for new API keys).
      model: process.env.UNDISCOVERED_REELS_GEMINI_MODEL?.trim() || "gemini-flash-latest",
      geminiCaller: geminiGenerateContentJson,
      loadSpotCandidates,
      // Authoritative creator from the reel's own IG owner object (username +
      // name + avatar as one matched set), when the export included one.
      fetchCreator: async (reel) => (reel.ownerRaw ? extractInstagramOwner(reel.ownerRaw) : null),
    });

    let written = 0;
    if (body.write && db) {
      for (const record of summary.records) {
        try {
          UndiscoveredReelSchema.parse(record);
          await db.collection("undiscoveredReels").doc(record.id).set(record, { merge: true });
          written += 1;
        } catch {
          // skip an individual malformed record rather than fail the batch
        }
      }
    }

    return success({
      counts: summary.counts,
      written,
      wrote: body.write,
      records: summary.records.slice(0, 50),
    });
  });
}
