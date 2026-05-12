import { describe, expect, it } from "vitest";
import {
  parseExplicitLocationPhrase,
  parseSearchQueryIntent,
  resolveLocationIntent,
} from "./search-query-intent.js";

describe("explicit location phrase (query tail)", () => {
  it('parses "best food in boston"', () => {
    const tail = parseExplicitLocationPhrase("best food in boston");
    expect(tail?.explicitLocationText).toBe("boston");
    expect(tail?.preposition).toBe("in");
  });

  it('parses multi-token "coffee shops in new york"', () => {
    const tail = parseExplicitLocationPhrase("coffee shops in new york");
    expect(tail?.explicitLocationText).toBe("new york");
  });

  it('parses "hiking near san francisco"', () => {
    const tail = parseExplicitLocationPhrase("hiking near san francisco");
    expect(tail?.explicitLocationText).toBe("san francisco");
    expect(tail?.preposition).toBe("near");
  });

  it('parses "cafes by easton"', () => {
    const tail = parseExplicitLocationPhrase("cafes by easton");
    expect(tail?.explicitLocationText).toBe("easton");
    expect(tail?.preposition).toBe("by");
  });

  it('returns null for "food near me"', () => {
    expect(parseExplicitLocationPhrase("food near me")).toBeNull();
  });

  it("parses full intent for explicit location without indexed place row", () => {
    const intent = parseSearchQueryIntent("best food in boston");
    expect(intent.hasExplicitLocation).toBe(true);
    expect(intent.explicitLocationText).toBe("boston");
    expect(intent.locationModifierSource).toBe("query");
    expect(intent.location?.displayText).toBe("Boston");
    expect(intent.nearMe).toBe(false);
  });

  it('keeps nearMe for "food near me"', () => {
    const intent = parseSearchQueryIntent("food near me");
    expect(intent.nearMe).toBe(true);
    expect(intent.hasExplicitLocation).toBe(false);
    expect(intent.explicitLocationText).toBeNull();
  });

  it('has no explicit location for "best food"', () => {
    const intent = parseSearchQueryIntent("best food");
    expect(intent.hasExplicitLocation).toBe(false);
    expect(intent.explicitLocationText).toBeNull();
  });

  it("resolveLocationIntent yields synthetic display when place unresolved", () => {
    const loc = resolveLocationIntent("best food in boston", () => null);
    expect(loc?.normalized).toBe("boston");
    expect(loc?.displayText).toBe("Boston");
  });

  it('parses "coffee shops in new york"', () => {
    const intent = parseSearchQueryIntent("coffee shops in new york");
    expect(intent.hasExplicitLocation).toBe(true);
    expect(intent.explicitLocationText).toBe("new york");
  });

  it('parses "hiking near san francisco"', () => {
    const intent = parseSearchQueryIntent("hiking near san francisco");
    expect(intent.hasExplicitLocation).toBe(true);
    expect(intent.explicitLocationText).toBe("san francisco");
  });
});
