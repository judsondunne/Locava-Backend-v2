#!/usr/bin/env node

const scriptName = process.argv[2] || "unknown-script";

console.error("THIS SCRIPT IS PERMANENTLY DISABLED.");
console.error("It previously wiped /posts when pointed at production Firestore.");
console.error("Use Firestore emulator-only tests instead.");
console.error(`Refused script: ${scriptName}`);
process.exit(1);
