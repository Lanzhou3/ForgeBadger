export type TerminalWebSocketMessage =
  | {
      type: "terminal_output";
      payload: { data: string };
    }
  | {
      type: "terminal_error";
      payload: { message: string };
    };

export function parseTerminalWebSocketMessage(raw: unknown): TerminalWebSocketMessage | null {
  if (typeof raw !== "string") {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || !isRecord(value.payload)) {
    return null;
  }

  if (value.type === "terminal_output" && typeof value.payload.data === "string") {
    return {
      type: "terminal_output",
      payload: { data: value.payload.data }
    };
  }

  if (value.type === "terminal_error" && typeof value.payload.message === "string") {
    return {
      type: "terminal_error",
      payload: { message: value.payload.message }
    };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
