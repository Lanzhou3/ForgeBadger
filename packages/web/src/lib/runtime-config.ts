export interface OpenForgeRuntimeConfig {
  gatewayBaseUrl?: string;
}

declare global {
  interface Window {
    __OPENFORGE_RUNTIME__?: OpenForgeRuntimeConfig;
  }
}

const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:48731";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function getGatewayBaseUrl(): string {
  if (typeof window !== "undefined") {
    const runtimeGatewayBaseUrl = nonEmpty(window.__OPENFORGE_RUNTIME__?.gatewayBaseUrl);
    if (runtimeGatewayBaseUrl) {
      return runtimeGatewayBaseUrl;
    }
  }

  return nonEmpty(process.env.NEXT_PUBLIC_GATEWAY_URL) ?? DEFAULT_GATEWAY_BASE_URL;
}
