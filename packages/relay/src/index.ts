import { createCompanionRelayServer } from './server.js';

const port = Number.parseInt(process.env.FORGEBADGER_RELAY_PORT ?? '18334', 10);
const host = process.env.FORGEBADGER_RELAY_HOST ?? '127.0.0.1';
const relay = await createCompanionRelayServer({ host, port });
console.log(`[relay] listening ${JSON.stringify({ host, port: relay.port })}`);

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
