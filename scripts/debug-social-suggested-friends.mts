const baseUrl = process.env.LOCAVA_BASE_URL ?? "http://127.0.0.1:8080";
const viewerId = process.env.LOCAVA_VIEWER_ID ?? "debug-viewer";
const headers = {
  "x-viewer-id": viewerId,
  "x-viewer-roles": "internal"
};

const response = await fetch(`${baseUrl}/v2/social/suggested-friends?limit=20&surface=onboarding`, { headers });
const json = await response.json();
console.log(JSON.stringify({ status: response.status, data: json }, null, 2));
