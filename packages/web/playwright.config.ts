import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.OPENFORGE_WEB_PORT ?? "48732";
const webUrl = process.env.OPENFORGE_WEB_URL ?? `http://localhost:${webPort}`;
const gatewayUrl =
  process.env.NEXT_PUBLIC_GATEWAY_URL ??
  process.env.OPENFORGE_GATEWAY_URL ??
  "http://127.0.0.1:48731";

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
    command: `NEXT_PUBLIC_GATEWAY_URL=${gatewayUrl} pnpm dev --port ${webPort}`,
    url: webUrl,
    reuseExistingServer: !process.env.CI,
  },
});
