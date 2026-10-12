import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The POSIX stop proof needs OS process metadata; some hosted sandboxes deny it. */
export const confirmedStopHostAvailable = (() => {
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') {
    try { return readFileSync(`/proc/${process.pid}/stat`, 'utf8').length > 0; }
    catch { return false; }
  }
  if (process.platform === 'darwin') {
    try {
      const output = execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'pid='],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return Number(output.trim()) === process.pid;
    } catch { return false; }
  }
  return false;
})();
