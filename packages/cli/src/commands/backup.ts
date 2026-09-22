import { createInstanceBackup } from "../runtime/backup.js";

export async function runBackup(options: { output: string }): Promise<number> {
  const result = await createInstanceBackup(options);
  process.stdout.write(`Backup created: ${result.output}\nContains runtime configuration and secrets (0700 directory, 0600 files). Store it privately. Project files and CLI logins are not included.\n`);
  return 0;
}
