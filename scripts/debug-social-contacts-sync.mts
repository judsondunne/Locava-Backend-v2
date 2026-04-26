const baseUrl = process.env.LOCAVA_BASE_URL ?? "http://127.0.0.1:8080";
const viewerId = process.env.LOCAVA_VIEWER_ID ?? "debug-viewer";
const headers = {
  "content-type": "application/json",
  "x-viewer-id": viewerId,
  "x-viewer-roles": "internal"
};

const payload = {
  contacts: [
    {
      name: "Test User",
      phoneNumbers: ["6507046433"],
      emails: []
    }
  ]
};

const response = await fetch(`${baseUrl}/v2/social/contacts/sync`, {
  method: "POST",
  headers,
  body: JSON.stringify(payload)
});
const json = await response.json();
console.log(JSON.stringify({ status: response.status, data: json }, null, 2));
