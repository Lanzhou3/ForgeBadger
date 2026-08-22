/**
 * Dispatch delivery confirmation (post-M3): `tmux send-keys` reports success
 * even when the target CLI is showing a modal dialog that swallows the input
 * (verified in E2E-M3: Claude Code's workspace-trust dialog ate an approved
 * dispatch while the API still returned `dispatched: true`). The bridge
 * dispatch path therefore reads the pane back after writing and only then
 * claims delivery.
 *
 * Pure helpers are exported for unit tests; the polling loop injects `sleep`
 * so tests never wait in real time.
 */

/** Thrown (as the message of an Error) when the read-back never observes the input. */
export const DISPATCH_DELIVERY_UNCONFIRMED = "BRIDGE_DELIVERY_UNCONFIRMED";

export interface DispatchConfirmOptions {
  /** Total read-back budget after the write. */
  timeoutMs: number;
  /** Poll interval between capture-pane reads. */
  intervalMs: number;
  /** Test hook; defaults to setTimeout-based sleep. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export const DEFAULT_DISPATCH_CONFIRM: Readonly<DispatchConfirmOptions> = Object.freeze({
  timeoutMs: 4000,
  intervalMs: 300
});

/** How many normalized message characters identify a delivery (messages run to 4000 chars). */
const NEEDLE_LENGTH = 40;

/**
 * Normalize pane/message text for comparison: strip ANSI escape sequences
 * (capture-pane runs with `-e`) and remove ALL whitespace, so terminal line
 * wrapping cannot split the needle.
 */
export function normalizePaneText(input: string): string {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC ... BEL/ST
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\x1b[()#][0-9A-Za-z]/g, "") // charset / other 3-byte sequences
    .replace(/\x1b[@-Z\\^_]/g, "") // two-byte escapes (note: \\ already consumed above)
    .replace(/\x1b/g, "")
    .replace(/\s+/g, "");
}

/** The normalized message prefix the pane must show to count as delivered. */
export function deliveryNeedle(message: string): string {
  return normalizePaneText(message).slice(0, NEEDLE_LENGTH);
}

/**
 * Poll `capture` until the normalized pane contains `needle` or the budget
 * runs out. An empty needle (unidentifiable message) confirms trivially.
 */
export async function confirmDelivery(
  capture: () => Promise<string>,
  needle: string,
  options: DispatchConfirmOptions
): Promise<boolean> {
  if (needle === "") return true;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const pane = normalizePaneText(await capture());
    if (pane.includes(needle)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(options.intervalMs);
  }
}
