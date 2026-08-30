import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_NPM_INSTALL_TIMEOUT_MS,
  buildNpmInstallArgs,
  readPositiveIntegerEnv,
  runCommand
} from "./smoke-npm-package-runner.mjs";

const workspaceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const smokeRoot = await mkdtemp(path.join(tmpdir(), "forgebadger-npm-smoke-"));
const packDir = path.join(smokeRoot, "pack");
const npmPrefix = path.join(smokeRoot, "npm-prefix");
const npmCache = path.join(smokeRoot, "npm-cache");
const stateDir = path.join(smokeRoot, "state");
const tmuxPrefix = `of-smoke-${process.pid}-`;
const commandTimeoutMs = readPositiveIntegerEnv(
  process.env,
  "FORGEBADGER_NPM_SMOKE_COMMAND_TIMEOUT_MS",
  DEFAULT_COMMAND_TIMEOUT_MS
);
const npmInstallTimeoutMs = readPositiveIntegerEnv(
  process.env,
  "FORGEBADGER_NPM_SMOKE_INSTALL_TIMEOUT_MS",
  DEFAULT_NPM_INSTALL_TIMEOUT_MS
);

try {
  console.log(`ForgeBadger npm smoke root: ${smokeRoot}`);

  await mkdir(packDir, { recursive: true });
  runStep("build npm package artifacts", "pnpm", ["--dir", workspaceRoot, "build:npm"]);
  runStep("pack npm tarball", "pnpm", [
    "--dir",
    workspaceRoot,
    "--filter",
    "forgebadger",
    "pack",
    "--pack-destination",
    packDir
  ], { printOutput: false });

  const tarball = await findPackedTarball(packDir);
  console.log(`Packed tarball: ${tarball}`);

  runStep("install packed tarball", "npm", buildNpmInstallArgs({
    npmPrefix,
    npmCache,
    tarball
  }), { timeoutMs: npmInstallTimeoutMs });

  const forgebadgerBin = resolveForgeBadgerBin(npmPrefix);
  runStep("run installed forgebadger doctor", forgebadgerBin, ["doctor"], {
    env: {
      FORGEBADGER_STATE_DIR: stateDir,
      FORGEBADGER_TMUX_PREFIX: tmuxPrefix
    }
  });
  console.log("[smoke:npm] start installed services and run API smoke");
  await runStartSmoke(forgebadgerBin);
} finally {
  cleanupTmuxSessions();
  if (process.env.FORGEBADGER_KEEP_NPM_SMOKE_ROOT !== "1") {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

function runStep(label, command, args, options = {}) {
  console.log(`[smoke:npm] ${label}`);
  return run(command, args, { ...options, label });
}

function run(command, args, options = {}) {
  return runCommand(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      ...options.env
    },
    label: options.label,
    printOutput: options.printOutput,
    timeoutMs: options.timeoutMs ?? commandTimeoutMs
  });
}

async function findPackedTarball(directory) {
  const tarballs = [];
  await collectTarballs(directory, tarballs);

  if (tarballs.length === 0) {
    throw new Error(`pnpm pack did not create a .tgz file under ${directory}`);
  }

  tarballs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return tarballs[0].filePath;
}

async function collectTarballs(directory, tarballs) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTarballs(filePath, tarballs);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".tgz")) {
      const stats = await stat(filePath);
      tarballs.push({ filePath, mtimeMs: stats.mtimeMs });
    }
  }
}

function resolveForgeBadgerBin(prefix) {
  const extension = process.platform === "win32" ? ".cmd" : "";
  const candidates = [
    path.join(prefix, process.platform === "win32" ? "" : "bin", `forgebadger${extension}`),
    path.join(prefix, "node_modules", ".bin", `forgebadger${extension}`)
  ];
  const binPath = candidates.find((candidate) => existsSync(candidate));
  if (!binPath) {
    throw new Error(`Installed forgebadger binary was not found at ${candidates.join(" or ")}`);
  }
  return binPath;
}

async function runStartSmoke(forgebadgerBin) {
  const gatewayPort = await getAvailablePort();
  const webPort = await getAvailablePort();
  const projectRoot = path.join(smokeRoot, "project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), "{\"name\":\"forgebadger-smoke\"}\n");

  const child = spawn(forgebadgerBin, [
    "start",
    "--host",
    "127.0.0.1",
    "--gateway-port",
    String(gatewayPort),
    "--web-port",
    String(webPort)
  ], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      FORGEBADGER_STATE_DIR: stateDir,
      FORGEBADGER_TMUX_PREFIX: tmuxPrefix
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  try {
    await waitForUrl(`http://127.0.0.1:${gatewayPort}/api/v1/health`, exitPromise, () => output);
    await waitForUrl(`http://127.0.0.1:${webPort}/`, exitPromise, () => output);

    const email = `smoke-${Date.now()}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const registered = await postJson(`http://127.0.0.1:${gatewayPort}/api/v1/auth/register`, {
      email,
      password
    });
    const token = registered.data.token;
    await postJson(`http://127.0.0.1:${gatewayPort}/api/v1/auth/login`, { email, password });
    await postJson(
      `http://127.0.0.1:${gatewayPort}/api/v1/projects/import`,
      {
        name: "Smoke Project",
        path: projectRoot,
        aiTool: "claude"
      },
      token
    );
  } finally {
    await stopChild(child, exitPromise);
  }
}

function cleanupTmuxSessions() {
  spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
    encoding: "utf8",
    shell: false
  }).stdout?.split("\n")
    .filter((name) => name.startsWith(tmuxPrefix))
    .forEach((name) => {
      spawnSync("tmux", ["kill-session", "-t", name], { stdio: "ignore", shell: false });
    });
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) {
    throw new Error("Unable to allocate a local smoke-test port");
  }
  return port;
}

async function waitForUrl(url, exitPromise, getOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const exited = await Promise.race([
      exitPromise.then((exit) => ({ exited: true, exit })),
      delay(250).then(() => ({ exited: false }))
    ]);
    if (exited.exited) {
      throw new Error(`forgebadger start exited before ${url} became ready: ${JSON.stringify(exited.exit)}\n${getOutput()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the startup deadline expires.
    }
  }
  throw new Error(`Timed out waiting for ${url}\n${getOutput()}`);
}

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0) {
    throw new Error(`Request failed: ${url} ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function stopChild(child, exitPromise) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exitPromise.then(() => true),
    delay(5_000).then(() => false)
  ]);
  if (!stopped) {
    child.kill("SIGKILL");
    await exitPromise;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
