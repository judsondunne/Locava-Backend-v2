/**
 * Vitest loads imported modules before any test body runs.
 * Backendv2's Firestore client guard requires FIRESTORE_TEST_MODE whenever NODE_ENV=test.
 */
process.env.FIRESTORE_TEST_MODE ??= "disabled";
