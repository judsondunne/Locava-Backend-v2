/**
 * Prints curl commands for POST /debug/notifications/send-test (20 cases).
 *
 * Usage:
 *   npx tsx scripts/debug-notifications-curl.mts -- --recipientId UID --baseUrl http://127.0.0.1:8080
 *
 * Requires NOTIFICATION_TEST_SECRET in the shell when you run the printed curls.
 */

type ArgMap = Record<string, string>;

function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--recipientId" && argv[i + 1]) {
      out.recipientId = argv[++i];
      continue;
    }
    if (a === "--baseUrl" && argv[i + 1]) {
      out.baseUrl = argv[++i].replace(/\/$/, "");
      continue;
    }
    if (a === "--postId" && argv[i + 1]) {
      out.postId = argv[++i];
      continue;
    }
    if (a === "--userId" && argv[i + 1]) {
      out.userId = argv[++i];
      continue;
    }
    if (a === "--chatId" && argv[i + 1]) {
      out.chatId = argv[++i];
      continue;
    }
    if (a === "--actorUserId" && argv[i + 1]) {
      out.actorUserId = argv[++i];
      continue;
    }
  }
  return out;
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl ?? "http://127.0.0.1:8080";
  const recipientId = args.recipientId ?? "REPLACE_RECIPIENT_ID";
  const postId = args.postId ?? "REPLACE_POST_ID";
  const userId = args.userId ?? "REPLACE_USER_ID";
  const chatId = args.chatId ?? "REPLACE_CHAT_ID";
  const actor = args.actorUserId ?? "REPLACE_ACTOR_ID";

  const hdr = `-H ${shellSingleQuote("Content-Type: application/json")} -H "x-locava-debug-secret: $NOTIFICATION_TEST_SECRET"`;

  const cases: Array<{
    n: number;
    label: string;
    body: Record<string, unknown>;
    note: string;
  }> = [
    { n: 1, label: "like -> post", body: { type: "like", postId, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 2, label: "post_like -> post", body: { type: "post_like", postId, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 3, label: "comment -> post", body: { type: "comment", postId, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 4, label: "post_comment -> post", body: { type: "post_comment", postId, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 5, label: "mention -> post", body: { type: "mention", postId, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 6, label: "tag -> post", body: { type: "tag", postId, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 7, label: "reply -> post", body: { type: "reply", postId, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 8, label: "saved_post -> post", body: { type: "saved_post", postId, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 9, label: "collection_add -> post", body: { type: "collection_add", postId, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 10, label: "follow -> user", body: { type: "follow", userId, actorUserId: actor, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 11, label: "new_follower -> user", body: { type: "new_follower", userId, actorUserId: actor, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 12, label: "user_follow -> user", body: { type: "user_follow", userId, actorUserId: actor, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 13, label: "chat -> chat", body: { type: "chat", chatId, actorUserId: actor, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 14, label: "message -> chat", body: { type: "message", chatId, actorUserId: actor, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 15, label: "dm -> chat", body: { type: "dm", chatId, actorUserId: actor, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 16, label: "new_message -> chat", body: { type: "new_message", chatId, actorUserId: actor, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 17, label: "friend_request -> user", body: { type: "friend_request", userId, actorUserId: actor, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 18, label: "friend_accept -> user", body: { type: "friend_accept", userId, actorUserId: actor, createInApp: true, sendPush: false }, note: "in-app only" },
    { n: 19, label: "system_post_featured -> post", body: { type: "system_post_featured", postId, createInApp: true, sendPush: true }, note: "in-app + push" },
    { n: 20, label: "generic_post -> post", body: { type: "generic_post", postId, createInApp: true, sendPush: false }, note: "in-app only" },
  ];

  console.log(`# Base: ${baseUrl}`);
  console.log(`# Recipient: ${recipientId}`);
  console.log(`# POST_ID=${postId} USER_ID=${userId} CHAT_ID=${chatId} ACTOR=${actor}`);
  console.log(`# Export NOTIFICATION_TEST_SECRET before running.`);
  console.log("");

  for (const c of cases) {
    const payload = {
      recipientId,
      title: `Test ${c.n}: ${c.label}`,
      body: "Tap to open",
      ...c.body,
    };
    const json = JSON.stringify(payload);
    console.log(`# ${c.n}. ${c.label} (${c.note})`);
    console.log(`curl -sS -X POST ${shellSingleQuote(`${baseUrl}/debug/notifications/send-test`)} ${hdr} --data-raw ${shellSingleQuote(json)}`);
    console.log("");
  }
}

main();
