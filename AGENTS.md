# PRODUCTION FIRESTORE SAFETY POLICY

Never run scripts that can delete, wipe, reseed, rebuild, migrate, repair, restore, or overwrite Firestore production data unless the user explicitly asks for that exact action and a dry-run report has already been reviewed.

Never run:
- npm run debug:feed:for-you-simple
- any script containing wipePostsCollection
- any script that deletes /posts
- any script that seeds posts after wiping
- any debug feed harness against production

Destructive Firestore operations are only allowed against the Firestore emulator and must require:
- FIRESTORE_EMULATOR_HOST set
- project is not learn-32d72
- ALLOW_DESTRUCTIVE_FIRESTORE_EMULATOR_ONLY exact confirmation
- assertEmulatorOnlyDestructiveFirestoreOperation guard

If a task involves production Firestore:
- default to read-only
- run dry-run first
- never delete /posts
- never touch likes/comments subcollections unless explicitly requested
- never modify postCanonicalBackups during restore
- prefer missing_or_empty_only writes
- stop and ask if any script contains delete/wipe/truncate/purge/reseed

This policy is mandatory for Codex/Cursor/agents.
