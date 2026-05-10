import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.OPENFORGE_WEB_PORT ?? "48732";
const webHost = process.env.OPENFORGE_WEB_HOST ?? "127.0.0.1";
const webUrl = process.env.OPENFORGE_WEB_URL ?? `http://${webHost}:${webPort}`;
const gatewayUrl =
  process.env.NEXT_PUBLIC_GATEWAY_URL ??
  process.env.OPENFORGE_GATEWAY_URL ??
  "http://127.0.0.1:48731";
const noProxy = mergeNoProxy(process.env.NO_PROXY ?? process.env.no_proxy, [
  "127.0.0.1",
  "localhost",
  "::1",
]);

process.env.NO_PROXY = noProxy;
process.env.no_proxy = noProxy;

function mergeNoProxy(value: string | undefined, hosts: string[]) {
  const entries = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  for (const host of hosts) {
    entries.add(host);
  }
  return [...entries].join(",");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `NEXT_PUBLIC_GATEWAY_URL=${gatewayUrl} pnpm dev --hostname ${webHost} --port ${webPort}`,
    url: webUrl,
    reuseExistingServer: !process.env.CI,
  },
});
