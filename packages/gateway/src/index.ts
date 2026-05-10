import { startGateway } from "./runtime/start-gateway.js";

const gateway = await startGateway();

console.log(
  JSON.stringify({
    level: "info",
    action: "gateway.start",
    host: gateway.host,
    port: gateway.port,
    timestamp: new Date().toISOString()
  })
);
