export interface ModelEndpointHealth {
  healthy: boolean;
  endpoint: string;
  latencyMs: number;
  timeoutMs: number;
  statusCode?: number;
  checkedAt: string;
  error?: string;
}

export interface CheckModelEndpointInput {
  endpoint: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function checkModelEndpoint(input: CheckModelEndpointInput): Promise<ModelEndpointHealth> {
  const timeoutMs = input.timeoutMs ?? 3000;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => Date.now());
  const start = now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(input.endpoint, {
      method: "HEAD",
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, now() - start);
    return {
      healthy: response.status < 500,
      endpoint: input.endpoint,
      latencyMs,
      timeoutMs,
      statusCode: response.status,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const latencyMs = Math.max(0, now() - start);
    return {
      healthy: false,
      endpoint: input.endpoint,
      latencyMs,
      timeoutMs,
      checkedAt: new Date().toISOString(),
      error: error instanceof DOMException && error.name === "AbortError"
        ? "Request timed out"
        : error instanceof Error
          ? error.message
          : "Endpoint check failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
