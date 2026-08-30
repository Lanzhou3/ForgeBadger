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
  if (typeof window !== "undefined") {
    const runtimeGatewayBaseUrl = nonEmpty(window.__FORGEBADGER_RUNTIME__?.gatewayBaseUrl);
    if (runtimeGatewayBaseUrl) {
      return runtimeGatewayBaseUrl;
    }
  }

  return nonEmpty(process.env.NEXT_PUBLIC_GATEWAY_URL) ?? DEFAULT_GATEWAY_BASE_URL;
}
