export interface ForgeBadgerRuntimeConfig {
  gatewayBaseUrl?: string;
}

declare global {
  interface Window {
    __FORGEBADGER_RUNTIME__?: ForgeBadgerRuntimeConfig;
  }
}

const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:48731";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function getGatewayBaseUrl(): string {
  const envGatewayBaseUrl = nonEmpty(process.env.NEXT_PUBLIC_GATEWAY_URL);
  // In `next dev` the placeholder `public/forgebadger-runtime.js` (default
  // port) is served and would shadow NEXT_PUBLIC_GATEWAY_URL, so an explicit
  // env override must win in development. In production the runtime file keeps
  // winning: the published CLI rewrites it with the real configured gateway
  // URL at `forgebadger start`, while the standalone bundle only carries a
  // build-time (possibly stale) env value.
  if (process.env.NODE_ENV === "development" && envGatewayBaseUrl) {
    return envGatewayBaseUrl;
  }
  if (typeof window !== "undefined") {
    const runtimeGatewayBaseUrl = nonEmpty(window.__FORGEBADGER_RUNTIME__?.gatewayBaseUrl);
    if (runtimeGatewayBaseUrl) {
      return runtimeGatewayBaseUrl;
    }
  }

  return envGatewayBaseUrl ?? DEFAULT_GATEWAY_BASE_URL;
}
