export type TerminalWebSocketMessage =
  | { type: "terminal_exit"; payload: { exitCode: number } }
  | {
      type: "terminal_output";
      payload: { data: string; sequence?: number };
    }
  | {
      /** Scrollback replay, sent once per attach BEFORE any live output. */
      type: "terminal_history";
      payload: { data: string; sequence?: number };
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

  if ((value.type === "terminal_output" || value.type === "terminal_history") && typeof value.payload.data === "string") {
    const sequence = value.payload.sequence;
    if (sequence !== undefined && (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence <= 0)) return null;
    return {
      type: value.type,
      payload: { data: value.payload.data, ...(sequence === undefined ? {} : { sequence }) },
    };
  }
  if (value.type === "terminal_exit" && typeof value.payload.exitCode === "number" && Number.isInteger(value.payload.exitCode)) {
    return { type: "terminal_exit", payload: { exitCode: value.payload.exitCode } };
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
