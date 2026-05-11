import type { CopilotModelClient, CopilotModelRequest, CopilotModelEvent } from "./types.js";

export type CopilotFetch = typeof fetch;

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
