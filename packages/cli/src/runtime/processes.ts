import { spawn, type ChildProcess } from "node:child_process";

export function spawnNode(entry: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [entry], {
    env,
    stdio: "inherit"
  });
}

export function installShutdownHandlers(children: ChildProcess[]): void {
  const shutdown = () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
