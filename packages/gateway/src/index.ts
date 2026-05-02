import { loadEnv } from "./config/env.js";
import { startupGateway } from "./services/startup.js";
import { createGatewayApp } from "./server.js";

const env = loadEnv();
const { db, sessionManager, apiKeyStore, eventBus } = await startupGateway({ env });

const { server, recoveryReady } = createGatewayApp({
  jwtSecret: env.OPENFORGE_JWT_SECRET,
  masterKey: env.OPENFORGE_MASTER_KEY,
  db,
  sessionManager,
  apiKeyStore,
  eventBus
});

await recoveryReady;
server.listen(env.OPENFORGE_PORT, env.OPENFORGE_HOST, () => {
  console.log(
    JSON.stringify({
      level: "info",
      action: "gateway.start",
      host: env.OPENFORGE_HOST,
      port: env.OPENFORGE_PORT,
      timestamp: new Date().toISOString()
    })
  );
});
