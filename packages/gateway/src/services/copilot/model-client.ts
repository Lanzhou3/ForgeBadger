import type { CopilotModelClient, CopilotModelRequest, CopilotModelEvent, CopilotModelRequestOptions } from "./types.js";

export type CopilotFetch = typeof fetch;

export class CopilotSseParseError extends Error {
  constructor() {
    super("Invalid provider SSE frame");
    this.name = "CopilotSseParseError";
  }
}

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

  abstract createResponse(request: CopilotModelRequest, options?: CopilotModelRequestOptions): Promise<CopilotModelEvent[]>;

  protected async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json() as unknown;
    } catch {
      return {};
    }
  }
}

export async function readSseJsonObjects(response: Response, onObject?: (object: unknown) => void): Promise<unknown[]> {
  if (!response.body) return [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const objects: unknown[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (parsed !== undefined) {
        objects.push(parsed);
        onObject?.(parsed);
      }
    }
  }

  buffer += decoder.decode();
  const parsed = parseSseFrame(buffer);
  if (parsed !== undefined) {
    objects.push(parsed);
    onObject?.(parsed);
  }
  return objects;
}

export function isEventStreamResponse(response: Response): boolean {
  return response.headers.get("Content-Type")?.toLowerCase().includes("text/event-stream") ?? false;
}

function parseSseFrame(frame: string): unknown | undefined {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    throw new CopilotSseParseError();
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
