const PHONE_SOURCE_FIELDS = [
  "phoneNumber",
  "phone",
  "phone_number",
  "number",
  "phoneE164",
  "phoneDigits",
  "contactPhone",
] as const;

export type PhoneNormalizationResult = {
  raw: string;
  digits: string | null;
  phoneLast10: string | null;
  phoneE164: string | null;
  queryKeys: string[];
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

export function derivePhoneLast10(digits: string): string | null {
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length > 11 && digits.startsWith("1")) return digits.slice(-10);
  return null;
}

export function normalizePhoneForSearch(rawValue: unknown): PhoneNormalizationResult {
  const raw = clean(rawValue);
  if (!raw) {
    return { raw: "", digits: null, phoneLast10: null, phoneE164: null, queryKeys: [] };
  }
  const digits = digitsOnly(raw);
  if (!digits) {
    return { raw, digits: null, phoneLast10: null, phoneE164: null, queryKeys: [] };
  }
  const phoneLast10 = derivePhoneLast10(digits);
  const phoneE164 = phoneLast10 ? `+1${phoneLast10}` : null;
  const keys = new Set<string>();
  keys.add(raw);
  keys.add(digits);
  if (phoneLast10) {
    keys.add(phoneLast10);
    keys.add(`1${phoneLast10}`);
    keys.add(`+1${phoneLast10}`);
  } else {
    keys.add(`+${digits}`);
  }
  return {
    raw,
    digits,
    phoneLast10,
    phoneE164,
    queryKeys: [...keys].filter((v) => v.trim().length > 0),
  };
}

export type DerivedPhoneSearchFields = {
  phoneDigits?: string;
  phoneE164?: string;
  phoneLast10?: string;
  phoneSearchKeys?: string[];
  sourcePhoneValue?: string;
};

export function derivePhoneSearchFieldsFromDoc(docData: Record<string, unknown>): DerivedPhoneSearchFields {
  const variants: PhoneNormalizationResult[] = [];
  for (const key of PHONE_SOURCE_FIELDS) {
    const normalized = normalizePhoneForSearch(docData[key]);
    if (normalized.queryKeys.length > 0) variants.push(normalized);
  }
  const first = variants[0];
  if (!first) return {};

  const searchKeys = new Set<string>();
  const phoneDigitsCandidate = first.digits ?? "";
  let phoneLast10Candidate: string | null = null;
  let phoneE164Candidate: string | null = null;
  for (const row of variants) {
    for (const key of row.queryKeys) searchKeys.add(key);
    if (!phoneLast10Candidate && row.phoneLast10) phoneLast10Candidate = row.phoneLast10;
    if (!phoneE164Candidate && row.phoneE164) phoneE164Candidate = row.phoneE164;
  }
  if (phoneDigitsCandidate) searchKeys.add(phoneDigitsCandidate);
  if (phoneLast10Candidate) searchKeys.add(phoneLast10Candidate);
  if (phoneE164Candidate) searchKeys.add(phoneE164Candidate);

  const out: DerivedPhoneSearchFields = {
    sourcePhoneValue: first.raw,
    phoneSearchKeys: [...searchKeys].filter(Boolean).sort(),
  };
  if (phoneDigitsCandidate) out.phoneDigits = phoneDigitsCandidate;
  if (phoneLast10Candidate) out.phoneLast10 = phoneLast10Candidate;
  if (phoneE164Candidate) out.phoneE164 = phoneE164Candidate;
  return out;
}

export function mergePhoneSearchFieldsIntoUserWritePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const derived = derivePhoneSearchFieldsFromDoc(payload);
  const next: Record<string, unknown> = { ...payload };
  if (derived.phoneDigits) next.phoneDigits = derived.phoneDigits;
  if (derived.phoneLast10) next.phoneLast10 = derived.phoneLast10;
  if (derived.phoneE164) next.phoneE164 = derived.phoneE164;
  if (derived.phoneSearchKeys && derived.phoneSearchKeys.length > 0) next.phoneSearchKeys = derived.phoneSearchKeys;
  return next;
}
