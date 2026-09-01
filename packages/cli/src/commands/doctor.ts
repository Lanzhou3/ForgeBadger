import {
  checkCliDependencies,
  describeCliTerminalRuntime,
  type CliCommandRunner
} from "../runtime/dependency-check.js";
import {
  inspectRuntimeConfig,
  type LoadRuntimeConfigOptions,
  type RuntimeConfig,
  type RuntimeConfigInspection
} from "../runtime/config.js";

interface OutputWriter {
  write(chunk: string): unknown;
}

export interface DoctorOptions {
  dependencyRunner?: CliCommandRunner;
  loadConfig?: () => Promise<RuntimeConfig>;
  inspectConfig?: (options: LoadRuntimeConfigOptions) => Promise<RuntimeConfigInspection>;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const inspection = await resolveDoctorRuntimeInspection(options);
  const dependencies = await checkCliDependencies(
    options.dependencyRunner,
    options.platform ?? process.platform
  );
  const requiredMissing = dependencies.filter((item) => item.required && !item.available);

  const initialization = inspection.initialized ? "" : " (not initialized)";
  stdout.write(`ForgeBadger state: ${inspection.stateDir}${initialization}\n`);
  if (!inspection.initialized) {
    stdout.write(
      `Diagnostic defaults: gateway=http://${inspection.gateway.host}:${inspection.gateway.port} web=http://${inspection.web.host}:${inspection.web.port}\n`
    );
  }
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

async function resolveDoctorRuntimeInspection(
  options: DoctorOptions
): Promise<RuntimeConfigInspection> {
  if (options.loadConfig) {
    const config = await options.loadConfig();
    return {
      stateDir: config.stateDir,
      initialized: true,
      gateway: config.gateway,
      web: config.web,
      config
    };
  }

  const inspectConfig = options.inspectConfig ?? inspectRuntimeConfig;
  return inspectConfig({
    ...(options.stateDir !== undefined ? { stateDir: options.stateDir } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.homeDir !== undefined ? { homeDir: options.homeDir } : {})
  });
}
