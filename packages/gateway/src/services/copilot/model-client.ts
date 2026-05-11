import type { CopilotModelClient, CopilotModelRequest, CopilotModelEvent } from "./types.js";

export type CopilotFetch = typeof fetch;

const defaultToolInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
} as const;

export abstract class FetchCopilotModelClient implements CopilotModelClient {
  protected readonly fetchImpl: CopilotFetch;

  protected constructor(fetchImpl?: CopilotFetch) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  abstract createResponse(request: CopilotModelRequest): Promise<CopilotModelEvent[]>;

  protected async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json() as unknown;
    } catch {
      return {};
    }
  }
}

export function toProviderToolName(name: string): string {
  const encoded = name.replace(/\./gu, "__dot__");
  return encoded.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 64);
}

export function fromProviderToolName(name: string): string {
  return name.replace(/__dot__/gu, ".");
}

export function normalizeToolInputSchema(
  inputSchema: Record<string, unknown> | undefined
): Record<string, unknown> {
  return inputSchema ?? defaultToolInputSchema;
}
