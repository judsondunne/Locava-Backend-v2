# Firestore Production Safety

## What Happened

A debug harness intended for local feed testing was able to run against the real Firestore source. The command `npm run debug:feed:for-you-simple` executed a destructive helper named `wipePostsCollection()`, which batch-deleted parent documents in `/posts` before seeding harness fixtures.

## Why Debug Feed Harnesses Are Dangerous

- They can delete or overwrite production collections quickly.
- They often mix destructive setup with normal-looking route probes.
- They are easy to misread as safe diagnostics because they print metrics after mutating data.
- They can be invoked through short npm aliases that hide the actual script body.

## Safe Emulator-Only Rules

- Set `FIRESTORE_EMULATOR_HOST`.
- Ensure `GCLOUD_PROJECT` and `GOOGLE_CLOUD_PROJECT` are not `learn-32d72`.
- Ensure `FIREBASE_CONFIG` does not reference `learn-32d72`.
- Set `ALLOW_DESTRUCTIVE_FIRESTORE_EMULATOR_ONLY=I_UNDERSTAND_THIS_ONLY_RUNS_ON_EMULATOR`.
- If `/posts` will be reset or reseeded, also set `ALLOW_POSTS_WIPE_IN_EMULATOR=I_UNDERSTAND_POSTS_WIPE_EMULATOR_ONLY`.
- Require `assertEmulatorOnlyDestructiveFirestoreOperation(...)` before any destructive Firestore path.

## How To Verify Emulator Mode

- Check `echo $FIRESTORE_EMULATOR_HOST`.
- Check `echo $GCLOUD_PROJECT`.
- Check `echo $GOOGLE_CLOUD_PROJECT`.
- Check `echo $FIREBASE_CONFIG` and confirm it does not mention `learn-32d72`.
- Run only scripts that log `EMULATOR_ONLY_SCRIPT_CONFIRMED`.

## Forbidden Scripts

- `npm run debug:feed:for-you-simple`
- `npm run debug:feed-for-you:simple`
- `npm run debug:feed:for-you-ready-deck`
- any script containing `wipePostsCollection`
- any script that wipes `/posts` and seeds fixtures afterward
- `npm run emergency:restore-posts:apply`

## Restore Safety Rules

- Default to dry-run only.
- Never overwrite `/posts` without an explicit reviewed plan.
- Never modify `postCanonicalBackups` during restore.
- Prefer `missing_or_empty_only` repair semantics over merge-false overwrites.
- Keep likes/comments subcollections untouched unless the restore scope explicitly requires them.

## Emergency Response Checklist

1. Stop all write-capable scripts and background jobs.
2. Disable known destructive npm aliases.
3. Add emulator-only code guards before any destructive helper.
4. Gate dangerous debug routes so they are not registered in normal app runs.
5. Run the static safety audit scripts.
6. Review `/Users/judsondunne/Locava-Master/Locava Backendv2/docs/emergency-production-delete-lockdown-audit.md`.
