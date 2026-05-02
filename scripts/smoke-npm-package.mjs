import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const smokeRoot = await mkdtemp(path.join(tmpdir(), "openforge-npm-smoke-"));
const packDir = path.join(smokeRoot, "pack");
const npmPrefix = path.join(smokeRoot, "npm-prefix");
const npmCache = path.join(smokeRoot, "npm-cache");
const stateDir = path.join(smokeRoot, "state");
const tmuxPrefix = `of-smoke-${process.pid}-`;

console.log(`OpenForge npm smoke root: ${smokeRoot}`);

await mkdir(packDir, { recursive: true });
run("pnpm", ["--dir", workspaceRoot, "build:npm"]);
run("pnpm", [
  "--dir",
  workspaceRoot,
  "--filter",
  "openforge",
  "pack",
  "--pack-destination",
  packDir
], { printOutput: false });

const tarball = await findPackedTarball(packDir);
console.log(`Packed tarball: ${tarball}`);

run("npm", [
  "install",
  "--prefix",
  npmPrefix,
  "--cache",
  npmCache,
  "--ignore-scripts=false",
  "--no-audit",
  "--no-fund",
  tarball
]);

const openforgeBin = resolveOpenForgeBin(npmPrefix);
run(openforgeBin, ["doctor"], {
  env: {
    OPENFORGE_STATE_DIR: stateDir,
    OPENFORGE_TMUX_PREFIX: tmuxPrefix
  }
});
await runStartSmoke(openforgeBin);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      ...options.env
    },
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0 || result.signal) {
    process.stderr.write(`\nCommand failed: ${command} ${args.join(" ")}\n`);
    if (typeof result.status === "number") {
      process.stderr.write(`Exit status: ${result.status}\n`);
    }
    if (result.signal) {
      process.stderr.write(`Signal: ${result.signal}\n`);
    }
    if (result.stdout) {
      process.stderr.write("\nstdout:\n");
      process.stderr.write(result.stdout);
      if (!result.stdout.endsWith("\n")) {
        process.stderr.write("\n");
      }
    }
    if (result.stderr) {
      process.stderr.write("\nstderr:\n");
      process.stderr.write(result.stderr);
      if (!result.stderr.endsWith("\n")) {
        process.stderr.write("\n");
      }
    }
    throw new Error(`${command} ${args.join(" ")} failed`);
  }

  if (options.printOutput !== false && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (options.printOutput !== false && result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
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

function resolveOpenForgeBin(prefix) {
  const extension = process.platform === "win32" ? ".cmd" : "";
  const candidates = [
    path.join(prefix, process.platform === "win32" ? "" : "bin", `openforge${extension}`),
    path.join(prefix, "node_modules", ".bin", `openforge${extension}`)
  ];
  const binPath = candidates.find((candidate) => existsSync(candidate));
  if (!binPath) {
    throw new Error(`Installed openforge binary was not found at ${candidates.join(" or ")}`);
  }
  return binPath;
}

async function runStartSmoke(openforgeBin) {
  const gatewayPort = await getAvailablePort();
  const webPort = await getAvailablePort();
  const projectRoot = path.join(smokeRoot, "project");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "package.json"), "{\"name\":\"openforge-smoke\"}\n");

  const child = spawn(openforgeBin, [
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
      OPENFORGE_STATE_DIR: stateDir,
      OPENFORGE_TMUX_PREFIX: tmuxPrefix
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
    const password = "password123";
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
      throw new Error(`openforge start exited before ${url} became ready: ${JSON.stringify(exited.exit)}\n${getOutput()}`);
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
