import { spawn } from "node:child_process";

import { OBSERVATION_MAX_CAPTURE_BYTES, OBSERVATION_TIMEOUT_MS, PortfolioObservationError } from "./observation-contract.js";

export interface FixedGitCommand {
  executable: "git";
  args: readonly string[];
  timeoutMs: number;
  maxCombinedOutputBytes: number;
  signal?: AbortSignal;
}

export interface FixedGitExecutor {
  execute(input: FixedGitCommand): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/** The only process boundary used by V1 collection: fixed argv, never a shell. */
export class NodeFixedGitExecutor implements FixedGitExecutor {
  execute(input: FixedGitCommand): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!isFixedGitStatusCommand(input)) {
      return Promise.reject(new PortfolioObservationError("PORTFOLIO_OBSERVATION_GIT_COMMAND_INVALID"));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(input.executable, [...input.args], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let settled = false;
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      const finish = (result: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", abort);
        result();
      };
      const abort = () => {
        child.kill();
        finish(() => reject(new PortfolioObservationError("PORTFOLIO_OBSERVATION_GIT_ABORTED")));
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(() => reject(new PortfolioObservationError("PORTFOLIO_OBSERVATION_GIT_TIMEOUT")));
      }, input.timeoutMs);
      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        const combined = stdout.length + stderr.length + chunk.length;
        if (combined > input.maxCombinedOutputBytes) {
          child.kill();
          finish(() => reject(new PortfolioObservationError("PORTFOLIO_OBSERVATION_GIT_OUTPUT_LIMIT")));
          return;
        }
        if (target === "stdout") stdout = Buffer.concat([stdout, chunk]);
        else stderr = Buffer.concat([stderr, chunk]);
      };
      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", () => finish(() => reject(new PortfolioObservationError("PORTFOLIO_OBSERVATION_GIT_FAILED"))));
      child.once("close", (exitCode) => finish(() => resolve({ stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), exitCode: exitCode ?? 1 })));
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

function isFixedGitStatusCommand(input: FixedGitCommand): boolean {
  if (input.executable !== "git" || input.timeoutMs !== OBSERVATION_TIMEOUT_MS || input.maxCombinedOutputBytes !== OBSERVATION_MAX_CAPTURE_BYTES) {
    return false;
  }
  const [flag, root, command, porcelain, branch, ...rest] = input.args;
  return flag === "-C" && typeof root === "string" && root.length > 0
    && command === "status" && porcelain === "--porcelain=v1" && branch === "--branch" && rest.length === 0;
}
