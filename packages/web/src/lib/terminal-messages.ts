const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;

export function createTerminalInputMessage(data: string): string {
  return JSON.stringify({ type: "terminal_input", payload: { data } });
}

export function createTerminalResizeMessage(size: { cols: number; rows: number }): string | null {
  if (!isTerminalSize(size.cols, size.rows)) {
    return null;
  }

  return JSON.stringify({
    type: "terminal_resize",
    payload: {
      cols: size.cols,
      rows: size.rows
    }
  });
}

function isTerminalSize(cols: number, rows: number): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols > 0 &&
    rows > 0 &&
    cols <= MAX_TERMINAL_COLS &&
    rows <= MAX_TERMINAL_ROWS
  );
}
