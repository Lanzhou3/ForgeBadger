import { SessionServerClient } from "../src/services/session-server-client.js";
import { resolveSessionServerTokenPath } from "../src/services/session-server/auth-token.js";
import { homedir } from "node:os";
import path from "node:path";

const stateDir = path.join(homedir(), ".forgebadger");
const client = new SessionServerClient({
  ipcPath: String.raw`\.\pipe\forgebadger-session-server-v2-6516bbeb5f6329d5775a47344d37fe5b`,
  tokenPath: resolveSessionServerTokenPath(stateDir),
});
await client.connect();
const sessions = await client.listSessions();
console.log("daemon sessions:", JSON.stringify(sessions));
const names = [
  "fb-3de81fce-e635f056-b8f9-4c3a-9c0c-068c8ea54c69",
  "fb-3de81fce-13ac9a9a-ab41-4731-8c13-b72582c5440b",
  "fb-3de81fce-eb6de0e4-5dda-4a0d-b918-9cc0aca0c11d",
  "fb-3de81fce-f8e1b842-9187-46c0-9a7d-60349ef85bc4",
  "fb-3de81fce-2cf6ace1-a9fa-4127-aabf-25e1c2ed9050",
  "fb-3de81fce-22a6ff74-8f30-42fb-9afc-fe479f55bbde",
];
for (const n of names) console.log(n, await client.hasSession(n));
await client.disconnect();
process.exit(0);
