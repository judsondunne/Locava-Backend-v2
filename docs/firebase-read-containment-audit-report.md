# Firebase read containment — audit

## Purpose

The audit enumerates **direct** Firebase initialization surfaces (root `firebase-admin`, `firebase-admin/app`, modular `getFirestore` from `firebase-admin/firestore` or `firebase/firestore`, and dynamic `require("firebase-admin/firestore")`) under:

- `Locava Backendv2/src`
- `Locava Backend/src`
- `Locava Web/src`

Only **canonical wrapper files** are allowed without extra review:

| Path |
| --- |
| `Locava Backendv2/src/lib/firebase-admin.ts` |
| `Locava Backend/src/config/firebase.ts` |
| `Locava Backend/src/config/firebaseTracked.ts` |
| `Locava Web/src/config/firebase.js` |
| `Locava Web/src/config/firebase-admin.js` |

All other matches must either be removed (prefer routing through wrappers) or **grandfathered** in:

`Locava Backendv2/scripts/firebase-read-containment-audit.baseline.txt`

## How to run

From `Locava Backendv2`:

```bash
npm run audit:firebase-containment
```

Exit code **1** means a new unallowlisted path appeared. CI should run this script after dependency or Firebase refactors.

## Sample output

The command prints a markdown table of every finding and labels each row `allowlisted` or **`NEW`**. Regenerate this section after meaningful changes by copying the script output:

```text
(paste `npm run audit:firebase-containment` output here)
```

## Note on `firebase-admin/firestore` value imports

The audit does **not** flag `FieldValue`, `Timestamp`, and other value imports from `firebase-admin/firestore`; those are widespread and do not by themselves initialize an app. The focus is **app / Firestore getter** entrypoints that bypass the containment wrappers.
