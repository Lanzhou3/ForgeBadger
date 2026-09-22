import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

/** Reads the gateway-generated local recovery key (written at startup into the state dir). */
export async function readRecoveryKey(): Promise<string> {
  const stateDir = process.env.FORGEBADGER_STATE_DIR ?? join(homedir(), ".forgebadger");
  return (await readFile(join(stateDir, "account-recovery.key"), "utf8")).trim();
}

/** Fills the required recovery-key field on the register form. */
export async function fillRecoveryKey(page: Page): Promise<void> {
  await page.fill('input[name="recoveryKey"]', await readRecoveryKey());
}
