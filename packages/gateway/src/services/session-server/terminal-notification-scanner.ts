/**
 * Detect terminal-native notification signals in PTY output: the BEL
 * character, OSC 9, OSC 99 (kitty), and OSC 777 (iterm2) sequences.
 *
 * The scanner is incremental: pty output arrives in arbitrary chunks, so a
 * sequence may be split across pushes. The in-progress sequence (from the
 * opening ESC) is carried over to the next push and re-scanned, which keeps
 * payload reconstruction correct: the payload is always sliced from a single
 * text buffer that contains the whole sequence.
 *
 * An OSC is terminated by BEL, a bare `\` ("lazy ST"), or a true ST
 * (`ESC \`). Because `ESC` can also start a fresh sequence, an ESC observed
 * mid-OSC enters an `oscEsc` state: the payload collected so far is
 * captured, and the following character decides — `\` completes the OSC as
 * ST, `]` starts a new OSC (the aborted partial one is dropped), and
 * anything else aborts the partial OSC as a non-notification escape
 * sequence.
 *
 * If the pending sequence exceeds the byte cap, it is dropped and the rest
 * of that output chunk is ignored — scanning resumes on the next push
 * (per the design doc). This bounds both memory and per-push work.
 *
 * BEL coalescing: consecutive bells within `bellCoalesceMs` produce a single
 * event. The first bell always fires.
 */

export interface TerminalNotificationScannerOptions {
  bellCoalesceMs?: number;
  now?: () => number;
}

export type TerminalNotification =
  | { kind: "osc"; code: 9; text: string }
  | { kind: "osc"; code: 99; text: string }
  | { kind: "osc"; code: 777; title: string; body: string }
  | { kind: "bell" };

/** Drop sequences longer than this so a runaway OSC cannot hold memory. */
export const MAX_PENDING_SEQUENCE_BYTES = 4096;

const DEFAULT_BELL_COALESCE_MS = 2000;

type ScannerState = "text" | "esc" | "oscCode" | "oscText" | "oscEsc";

export class TerminalNotificationScanner {
  private state: ScannerState = "text";
  private code = 0;
  private payloadStart = 0;
  /** Index within the current buffer where the in-progress sequence began. */
  private sequenceStart = 0;
  /** -Infinity so the very first bell always fires regardless of the clock. */
  private lastBellAtMs = -Infinity;
  /** In-progress sequence carried over from the previous push. */
  private carry = "";
  /** Payload captured when an ESC is seen mid-OSC (state "oscEsc"). */
  private oscEscValue = "";
  private readonly bellCoalesceMs: number;
  private readonly now: () => number;
  private consumeResult: TerminalNotification | undefined;

  constructor(options: TerminalNotificationScannerOptions = {}) {
    this.bellCoalesceMs = options.bellCoalesceMs ?? DEFAULT_BELL_COALESCE_MS;
    this.now = options.now ?? Date.now;
  }

  push(chunk: string): TerminalNotification[] {
    const text = this.carry + chunk;
    this.carry = "";
    const events: TerminalNotification[] = [];
    const end = text.length;

    let k = 0;
    while (k < end) {
      const stateBefore = this.state;
      const next = this.consume(text, k, end);
      if (next <= k) {
        // No advance but the state changed: re-examine the same character in
        // the new state (e.g. the code-terminating character that also opens
        // the payload).
        if (next === k && this.state !== stateBefore) {
          continue;
        }
        break;
      }
      const event = this.consumeResult;
      this.consumeResult = undefined;
      if (event !== undefined) {
        events.push(event);
      }
      k = next;
      if (
        this.state !== "text" &&
        this.state !== "oscEsc" &&
        k - this.sequenceStart > MAX_PENDING_SEQUENCE_BYTES
      ) {
        // Oversized sequence: drop it and ignore the rest of this chunk.
        this.state = "text";
        this.carry = "";
        break;
      }
    }

    if (this.state !== "text") {
      // In "oscEsc" the payload is already captured in oscEscValue and only
      // the character after the ESC decides the outcome, so nothing is
      // carried; otherwise carry the sequence from its opening ESC.
      this.carry = this.state === "oscEsc" ? "" : text.slice(this.sequenceStart);
    }
    return events;
  }

  private consume(text: string, k: number, end: number): number {
    if (this.state === "text") {
      const ch = text[k];
      if (ch === "\x1b") {
        this.state = "esc";
        this.sequenceStart = k;
        return k + 1;
      }
      if (ch === "\x07") {
        const now = this.now();
        if (now - this.lastBellAtMs >= this.bellCoalesceMs) {
          this.lastBellAtMs = now;
          this.consumeResult = { kind: "bell" };
        }
        return k + 1;
      }
      return k + 1;
    }
    if (this.state === "esc") {
      const ch = text[k];
      if (ch === "]") {
        this.state = "oscCode";
        return k + 1;
      }
      if (ch === "\x1b") {
        // A bare ESC (ESC ESC …) restarts the sequence at this position.
        this.sequenceStart = k;
        return k + 1;
      }
      // Any other ESC sequence (CSI, char sets, …) is not a notification;
      // keep scanning the rest of the buffer after it.
      this.state = "text";
      return k + 1;
    }
    if (this.state === "oscCode") {
      const ch = text[k];
      if (ch === "\x1b") {
        // ESC mid-code: no payload collected yet; the next character
        // decides (ST terminator, new OSC, or abort).
        this.enterOscEsc(k, "");
        return k + 1;
      }
      if (ch !== undefined && ch >= "0" && ch <= "9") {
        return k + 1;
      }
      if (k === 0) {
        return k;
      }
      const codeDigits = text.slice(this.sequenceStart + 2, k);
      this.code = Number(codeDigits);
      this.state = "oscText";
      // The payload starts after the code, skipping the separating ';'.
      this.payloadStart = ch === ";" ? k + 1 : k;
      return ch === ";" ? k + 1 : k;
    }
    if (this.state === "oscText") {
      const ch = text[k];
      if (ch === "\x1b") {
        // ESC mid-payload: capture what we have; the next character
        // decides (ST terminator, new OSC, or abort).
        this.enterOscEsc(k, text.slice(this.payloadStart, k));
        return k + 1;
      }
      if (ch === "\x07" || ch === "\\") {
        this.finishOsc(text.slice(this.payloadStart, k));
        this.state = "text";
        return k + 1;
      }
      return k + 1;
    }
    if (this.state === "oscEsc") {
      const ch = text[k];
      if (ch === "\\") {
        // ESC `\` — the ST terminator completes the OSC.
        this.finishOsc(this.oscEscValue);
        this.state = "text";
        return k + 1;
      }
      if (ch === "]") {
        // A fresh OSC starts; the aborted partial one is dropped.
        this.oscEscValue = "";
        this.state = "oscCode";
        this.sequenceStart = k - 1;
        return k + 1;
      }
      if (ch === "\x1b") {
        // ESC ESC: restart the escape scan at this position.
        this.oscEscValue = "";
        this.state = "esc";
        this.sequenceStart = k;
        return k + 1;
      }
      // Any other character: the ESC began a non-notification escape
      // sequence; the partial OSC is dropped.
      this.oscEscValue = "";
      this.state = "text";
      return k + 1;
    }
    return k;
  }

  private enterOscEsc(k: number, value: string): void {
    this.state = "oscEsc";
    this.sequenceStart = k;
    this.oscEscValue = value;
  }

  private finishOsc(value: string): void {
    const code = this.code;
    this.consumeResult =
      code === 9
        ? isOsc9AuxiliaryPayload(value)
          ? undefined
          : { kind: "osc", code, text: value }
        : code === 99
          ? value.includes("p=?")
            ? undefined
            : { kind: "osc", code, text: value }
          : code === 777
            ? buildOsc777(value)
            : undefined;
  }
}

/**
 * OSC 9 is overloaded: alongside plain-text notifications (iTerm2/Ghostty)
 * it carries numeric sub-commands — most notably kitty-style `9;4` progress
 * bars that CLIs such as Kimi Code emit continuously when the terminal is on
 * their progress allowlist (which ForgeBadger triggers via TERM_PROGRAM). A
 * real notification message starts with text, so payloads whose first
 * `;`-separated segment is a bare integer are auxiliary sequences, not
 * notifications.
 */
export function isOsc9AuxiliaryPayload(payload: string): boolean {
  const first = payload.split(";", 1)[0] ?? "";
  return /^\d+$/.test(first);
}

function buildOsc777(value: string): { kind: "osc"; code: 777; title: string; body: string } | undefined {
  const parts = value.split(";");
  const verb = parts[0] ?? "";
  if (verb !== "notify") {
    return undefined;
  }
  const title = (parts[1] ?? "").trim();
  const body = parts.slice(2).join(";").trim();
  return { kind: "osc", code: 777, title, body };
}

/** Narrow an unknown value (e.g. a JSON-RPC message from the pipe) to a scanner event. */
export function isTerminalNotification(value: unknown): value is TerminalNotification {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "bell") {
    return true;
  }
  if (candidate.kind !== "osc") {
    return false;
  }
  if (candidate.code === 9 || candidate.code === 99) {
    return typeof candidate.text === "string";
  }
  if (candidate.code === 777) {
    return typeof candidate.title === "string" && typeof candidate.body === "string";
  }
  return false;
}
