#!/usr/bin/env node
import { getFirestoreSourceClient } from "../src/repositories/source-of-truth/firestore-client.js";
import { buildContactPhoneVariants, type LegacyPhoneField } from "../src/repositories/surfaces/suggested-friends.repository.js";
import { derivePhoneSearchFieldsFromDoc } from "../src/lib/phone-search-fields.js";

const LEGACY_FIELDS: LegacyPhoneField[] = [
  "number",
  "phoneNumber",
  "phone",
  "phone_number",
  "contactPhone",
  "phoneE164",
  "phoneDigits",
];

async function main(): Promise<void> {
  const inputPhones = process.argv.slice(2).filter((value) => value.trim().length > 0);
  if (inputPhones.length === 0) {
    throw new Error("usage: npm run debug:contact-phone-match -- <phone1> <phone2> ...");
  }
  const db = getFirestoreSourceClient();
  if (!db) throw new Error("Firestore source client unavailable");

  const byPhone = inputPhones.map((phone) => ({
    input: phone,
    built: buildContactPhoneVariants(phone),
  }));

  const phoneLast10 = [...new Set(byPhone.map((row) => row.built.phoneLast10).filter((v): v is string => Boolean(v)))];
  const variants = [...new Set(byPhone.flatMap((row) => row.built.variants))];

  const matches: Array<{
    userId: string;
    displayName: string | null;
    matched: string;
    missingCanonical: boolean;
    lazyRepairPatch: Record<string, unknown> | null;
  }> = [];

  const seen = new Set<string>();
  async function addDocs(
    docs: Array<{ id: string; data: () => Record<string, unknown> }>,
    matchedPrefix: string,
    field?: string,
    values?: string[],
  ) {
    for (const doc of docs) {
      const data = doc.data();
      const hitValue =
        field && values
          ? (typeof data[field] === "string" && values.includes(data[field] as string) ? (data[field] as string) : values[0] ?? "")
          : "";
      const key = `${doc.id}:${matchedPrefix}:${hitValue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const displayName =
        (typeof data.name === "string" && data.name.trim()) ||
        (typeof data.displayName === "string" && data.displayName.trim()) ||
        null;
      const missingCanonical = !data.phoneLast10 || !data.phoneDigits || !data.phoneE164;
      const lazyRepairPatch = missingCanonical ? derivePhoneSearchFieldsFromDoc(data) : null;
      matches.push({
        userId: doc.id,
        displayName,
        matched: field ? `${matchedPrefix}:${field}:${hitValue}` : matchedPrefix,
        missingCanonical,
        lazyRepairPatch,
      });
    }
  }

  for (let i = 0; i < phoneLast10.length; i += 10) {
    const chunk = phoneLast10.slice(i, i + 10);
    const snap = await db.collection("users").where("phoneLast10", "in", chunk).get();
    await addDocs(snap.docs as any, "canonical:phoneLast10", "phoneLast10", chunk);
  }
  for (let i = 0; i < variants.length; i += 10) {
    const chunk = variants.slice(i, i + 10);
    const snap = await db.collection("users").where("phoneSearchKeys", "array-contains-any", chunk).get();
    await addDocs(snap.docs as any, "canonical:phoneSearchKeys");
    for (const field of LEGACY_FIELDS) {
      const legacySnap = await db.collection("users").where(field, "in", chunk).get();
      await addDocs(legacySnap.docs as any, "legacy", field, chunk);
    }
  }

  console.log(
    JSON.stringify(
      {
        inputs: byPhone.map((row) => ({
          input: row.input,
          phoneLast10: row.built.phoneLast10,
          variants: row.built.variants,
        })),
        totalMatches: matches.length,
        matches,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
