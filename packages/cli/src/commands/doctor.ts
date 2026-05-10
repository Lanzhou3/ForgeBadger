import {
  checkCliDependencies,
  describeCliTerminalRuntime,
  type CliCommandRunner
} from "../runtime/dependency-check.js";
import { loadOrCreateRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";

interface OutputWriter {
  write(chunk: string): unknown;
}

export interface DoctorOptions {
  dependencyRunner?: CliCommandRunner;
  loadConfig?: () => Promise<RuntimeConfig>;
  platform?: NodeJS.Platform;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const config = await (options.loadConfig ?? loadOrCreateRuntimeConfig)();
  const dependencies = await checkCliDependencies(options.dependencyRunner);
  const requiredMissing = dependencies.filter((item) => item.required && !item.available);

  stdout.write(`OpenForge state: ${config.stateDir}\n`);
  for (const item of dependencies) {
    const marker = item.available ? "ok" : item.required ? "missing" : "optional-missing";
    const version = item.version ? ` ${item.version}` : "";
    const error = item.error ? ` - ${item.error}` : "";
    stdout.write(`${marker} ${item.name}${version}${error}\n`);
  }
  const terminalRuntime = describeCliTerminalRuntime(dependencies, options.platform);
  stdout.write(`terminal ${terminalRuntime.mode} - ${terminalRuntime.message}\n`);

  if (requiredMissing.length > 0) {
    stderr.write("Required dependencies are missing. Install them before launching terminal sessions.\n");
    return 1;
  }

  return 0;
}
