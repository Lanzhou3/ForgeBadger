import { restoreInstanceBackup } from "../runtime/backup.js";

export async function runRestore(options: { from: string; to: string }): Promise<number> {
  const result = await restoreInstanceBackup(options);
  process.stdout.write(`Restored to new state directory: ${result.stateDir}\nStart with FORGEBADGER_STATE_DIR set to this directory and clear old FORGEBADGER_DB_PATH overrides. JWT secret was rotated and browser sessions were revoked; CLI logins and project files must be restored separately.\n`);
  return 0;
}
