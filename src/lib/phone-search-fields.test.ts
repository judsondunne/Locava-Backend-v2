import { describe, expect, it } from "vitest";

import {
  derivePhoneSearchFieldsFromDoc,
  normalizePhoneForSearch,
} from "./phone-search-fields.js";

describe("normalizePhoneForSearch", () => {
  const cases = [
    "6507046433",
    "16507046433",
    "+16507046433",
    "(650) 704-6433",
    "650-704-6433",
    "650.704.6433",
    "+1 (650) 704-6433",
  ];

  for (const value of cases) {
    it(`normalizes ${value}`, () => {
      const normalized = normalizePhoneForSearch(value);
      expect(normalized.phoneLast10).toBe("6507046433");
      expect(normalized.phoneE164).toBe("+16507046433");
      expect(normalized.queryKeys).toContain("6507046433");
      expect(normalized.queryKeys).toContain("+16507046433");
    });
  }

  it("dedupes duplicate variants into one canonical key", () => {
    const derived = derivePhoneSearchFieldsFromDoc({
      phoneNumber: "(650) 704-6433",
      phone: "+1 (650) 704-6433",
      phone_number: "6507046433",
    });
    expect(derived.phoneLast10).toBe("6507046433");
    expect(derived.phoneE164).toBe("+16507046433");
    expect(derived.phoneSearchKeys?.filter((k) => k === "6507046433")).toHaveLength(1);
  });

  it("keeps parity with legacy final-10 behavior for US fixtures", () => {
    const legacyNormalize = (value: string) => value.replace(/[^0-9]/g, "").slice(-10);
    const inputs = [
      "6102338257",
      "+16102338257",
      "(610) 233-8257",
      "6507046433",
      "(650) 704-6433",
    ];
    const legacy = new Set(inputs.map(legacyNormalize).filter((v) => v.length === 10));
    const next = new Set(
      inputs
        .map((value) => normalizePhoneForSearch(value).phoneLast10)
        .filter((value): value is string => Boolean(value)),
    );
    expect([...next].sort()).toEqual([...legacy].sort());
  });
});
