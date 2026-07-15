import { describe, it, expect } from "vitest";
import { buildReelAttribution } from "./buildReelAttribution.js";
import { extractReelLocation, parseExtraction, type GeminiJsonCaller } from "./extractReelLocation.js";
import { matchReelToSpot, scoreNameMatch, type SpotCandidate } from "./matchReelToSpot.js";
import { assembleUndiscoveredReel, resolveReelLocation } from "./assembleUndiscoveredReel.js";
import { UndiscoveredReelSchema, type CollectedReelInput } from "../../../contracts/surfaces/undiscovered-reels.contract.js";

const CANDIDATES: SpotCandidate[] = [
  { id: "unx_spot_1", collection: "unexploredSpots", displayName: "Warren Falls", lat: 44.114, lng: -72.861 },
  { id: "unx_route_1", collection: "unexploredRoutes", displayName: "Quechee Gorge Trail", lat: 43.639, lng: -72.406 },
  { id: "unx_spot_2", collection: "unexploredSpots", displayName: "Texas Falls", lat: 43.925, lng: -72.899 },
];

describe("buildReelAttribution", () => {
  it("derives a profile URL from the username", () => {
    const a = buildReelAttribution({ shortcode: "x", caption: "", ownerUsername: "vt_hiker", ownerFullName: "VT Hiker", ownerProfilePicUrl: "https://p/a.jpg" } as CollectedReelInput);
    expect(a).toEqual({
      username: "vt_hiker",
      fullName: "VT Hiker",
      profilePicUrl: "https://p/a.jpg",
      profileUrl: "https://www.instagram.com/vt_hiker/",
    });
  });
  it("nulls missing fields and handles @ prefix", () => {
    const a = buildReelAttribution({ shortcode: "x", caption: "", ownerUsername: "@stowe.adventures" } as CollectedReelInput);
    expect(a.profileUrl).toBe("https://www.instagram.com/stowe.adventures/");
    expect(a.fullName).toBeNull();
  });
});

describe("scoreNameMatch / matchReelToSpot", () => {
  it("matches exact and near-exact names", () => {
    expect(scoreNameMatch("Warren Falls", "Warren Falls")).toBe(1);
    expect(scoreNameMatch("Warren Falls VT", "Warren Falls")).toBeGreaterThanOrEqual(0.9);
  });
  it("links an extracted name to the right uploaded spot", () => {
    const m = matchReelToSpot("Quechee Gorge", CANDIDATES);
    expect(m?.candidate.id).toBe("unx_route_1");
  });
  it("returns null when nothing clears the threshold", () => {
    expect(matchReelToSpot("Random Diner", CANDIDATES)).toBeNull();
    expect(matchReelToSpot(null, CANDIDATES)).toBeNull();
  });
});

describe("parseExtraction", () => {
  it("parses strict JSON and clamps confidence", () => {
    const e = parseExtraction('{"placeName":"Warren Falls","lat":44.1,"lng":-72.8,"activity":"swimming","confidence":1.4}');
    expect(e.placeName).toBe("Warren Falls");
    expect(e.confidence).toBe(1);
  });
  it("tolerates code fences and junk", () => {
    expect(parseExtraction("```json\n{\"placeName\":null,\"confidence\":0}\n```").placeName).toBeNull();
    expect(parseExtraction("not json").placeName).toBeNull();
  });
});

describe("extractReelLocation (injected Gemini)", () => {
  it("calls the model and returns parsed extraction", async () => {
    const caller: GeminiJsonCaller = async () => ({
      text: '{"placeName":"Texas Falls","lat":43.9,"lng":-72.9,"activity":"waterfall","confidence":0.8}',
      httpStatus: 200,
    });
    const e = await extractReelLocation("Chasing Texas Falls in Vermont 💦", { apiKey: "k", caller });
    expect(e.placeName).toBe("Texas Falls");
    expect(e.activity).toBe("waterfall");
  });
  it("returns empty on short caption without calling the model", async () => {
    let called = false;
    const caller: GeminiJsonCaller = async () => { called = true; return { text: "{}", httpStatus: 200 }; };
    const e = await extractReelLocation("hi", { apiKey: "k", caller });
    expect(called).toBe(false);
    expect(e.placeName).toBeNull();
  });
});

describe("resolveReelLocation precedence", () => {
  it("prefers a matched spot's exact coords", () => {
    const loc = resolveReelLocation(
      { placeName: "Warren Falls", latGuess: 44.0, lngGuess: -72.0, activity: null, confidence: 0.8 },
      { candidate: CANDIDATES[0]!, score: 0.95 },
    );
    expect(loc.source).toBe("spot_match");
    expect(loc.lat).toBe(44.114);
    expect(loc.matchedSpotId).toBe("unx_spot_1");
  });
  it("falls back to AI estimate when confident and no match", () => {
    const loc = resolveReelLocation(
      { placeName: "Somewhere", latGuess: 44.2, lngGuess: -72.7, activity: null, confidence: 0.7 },
      null,
    );
    expect(loc.source).toBe("ai_estimate");
    expect(loc.lat).toBe(44.2);
  });
  it("emits no-location when nothing is usable", () => {
    const loc = resolveReelLocation({ placeName: null, latGuess: null, lngGuess: null, activity: null, confidence: 0 }, null);
    expect(loc.source).toBe("none");
    expect(loc.lat).toBeNull();
  });
});

describe("assembleUndiscoveredReel", () => {
  it("produces a schema-valid record linked to its spot", () => {
    const reel: CollectedReelInput = {
      shortcode: "CxAbc123",
      caption: "Hidden gem: Warren Falls, VT",
      ownerUsername: "vt_explorer",
      ownerFullName: "VT Explorer",
      ownerProfilePicUrl: "https://p/x.jpg",
      videoUrl: "https://v/x.mp4",
    };
    const record = assembleUndiscoveredReel({
      reel,
      extraction: { placeName: "Warren Falls", latGuess: null, lngGuess: null, activity: "waterfall", confidence: 0.9 },
      match: { candidate: CANDIDATES[0]!, score: 0.95 },
      region: "VT",
      nowIso: "2026-07-12T00:00:00.000Z",
    });
    expect(() => UndiscoveredReelSchema.parse(record)).not.toThrow();
    expect(record.id).toBe("reel_CxAbc123");
    expect(record.location.matchedSpotId).toBe("unx_spot_1");
    expect(record.creator.profileUrl).toBe("https://www.instagram.com/vt_explorer/");
    expect(record.reelUrl).toBe("https://www.instagram.com/reel/CxAbc123/");
  });
});
