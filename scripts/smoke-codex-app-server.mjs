import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gatewayRequire = createRequire(new URL("../packages/gateway/package.json", import.meta.url));
const WebSocket = gatewayRequire("ws");

const CONNECT_TIMEOUT_MS = Number.parseInt(process.env.OPENFORGE_CODEX_APP_SERVER_SMOKE_CONNECT_TIMEOUT_MS ?? "10000", 10);
const RESPONSE_TIMEOUT_MS = Number.parseInt(process.env.OPENFORGE_CODEX_APP_SERVER_SMOKE_RESPONSE_TIMEOUT_MS ?? "10000", 10);
const SETTLE_TIMEOUT_MS = Number.parseInt(process.env.OPENFORGE_CODEX_APP_SERVER_SMOKE_SETTLE_TIMEOUT_MS ?? "250", 10);
const CODEX_BIN = process.env.OPENFORGE_CODEX_BIN ?? "codex";

export function buildCodexAppServerInitializeRequest(id = 1) {
  return {
    id,
    method: "initialize",
    params: {
      clientInfo: {
        name: "openforge",
        title: "OpenForge",
        version: "0.0.0"
      },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: []
      }
    }
  };
}

export function buildCodexAppServerInitializedNotification() {
  return { method: "initialized" };
}

export function buildCodexAppServerSmokeRoot(root) {
  return {
    root,
    home: path.join(root, "home"),
    codexHome: path.join(root, "codex-home"),
    project: path.join(root, "project"),
    tokenFile: path.join(root, "capability.token")
  };
}

export function buildCodexAppServerSmokeToken(buffer = randomBytes(24)) {
  return `of_${buffer.toString("base64url")}`;
}

export function sanitizeCodexAppServerEnv(parentEnv, paths) {
  const env = {};
  for (const key of ["PATH", "TMPDIR", "TEMP", "TMP"]) {
    if (parentEnv[key]) {
      env[key] = parentEnv[key];
    }
  }
  env.HOME = paths.home;
  env.CODEX_HOME = paths.codexHome;
  for (const key of ["LANG", "LC_ALL", "SHELL"]) {
    if (parentEnv[key]) {
      env[key] = parentEnv[key];
    }
  }
  return env;
}

export function buildCodexAppServerSmokeResult(input) {
  return {
    ok: true,
    mode: input.mode,
    root: input.root,
    codexHome: input.codexHome,
    project: input.project,
    listen: input.listen,
    userAgent: input.userAgent,
    platformFamily: input.platformFamily,
    platformOs: input.platformOs,
    promptOrTurnSent: false,
    extraMessageMethods: input.extraMessages
      .map((message) => message?.method)
      .filter((method) => typeof method === "string")
  };
}

export async function runCodexAppServerSmoke(options = {}) {
  const root = options.root
    ? path.resolve(options.root)
    : await mkdtemp(path.join(tmpdir(), "openforge-codex-app-server-smoke-"));
  const paths = buildCodexAppServerSmokeRoot(root);
  const token = buildCodexAppServerSmokeToken();
  const port = await getAvailablePort();
  const listen = `ws://127.0.0.1:${port}`;
  const sentMethods = [];
  let child;
  let childExit = null;
  let childError = null;
  let output = "";
  let ws;

  try {
    await prepareSmokeRoot(paths, token);
    child = spawn(CODEX_BIN, [
      "app-server",
      "--listen",
      listen,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      paths.tokenFile
    ], {
      cwd: paths.project,
      detached: process.platform !== "win32",
      env: sanitizeCodexAppServerEnv(process.env, paths),
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", (error) => {
      childError = error;
    });
    child.once("exit", (code, signal) => {
      childExit = { code, signal };
    });

    ws = await connectWebSocket(listen, token, () => childExit, () => childError, () => output);
    const messages = collectMessages(ws);
    const initialize = buildCodexAppServerInitializeRequest(1);
    sentMethods.push(initialize.method);
    ws.send(JSON.stringify(initialize));
    const response = await waitForResponse(messages, 1, RESPONSE_TIMEOUT_MS);
    validateInitializeResponse(response, paths.codexHome);

    const initialized = buildCodexAppServerInitializedNotification();
    sentMethods.push(initialized.method);
    ws.send(JSON.stringify(initialized));
    await delay(SETTLE_TIMEOUT_MS);

    assertNoPromptOrTurnSent(sentMethods);

    return buildCodexAppServerSmokeResult({
      mode: "app-server-websocket",
      root: paths.root,
      codexHome: paths.codexHome,
      project: paths.project,
      listen,
      userAgent: response.result.userAgent,
      platformFamily: response.result.platformFamily,
      platformOs: response.result.platformOs,
      extraMessages: messages.received.filter((message) => message.id !== 1)
    });
  } finally {
    await closeWebSocket(ws);
    if (child) {
      await stopChild(child);
    }
    if (process.env.OPENFORGE_KEEP_CODEX_APP_SERVER_SMOKE_ROOT !== "1" && !options.root) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function prepareSmokeRoot(paths, token) {
  await mkdir(paths.home, { recursive: true });
  await mkdir(paths.codexHome, { recursive: true });
  await mkdir(paths.project, { recursive: true });
  await writeFile(path.join(paths.project, "package.json"), "{\"name\":\"openforge-codex-app-server-smoke\"}\n");
  await writeFile(paths.tokenFile, `${token}\n`, { mode: 0o600 });
  await chmod(paths.tokenFile, 0o600);
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate a loopback port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function connectWebSocket(url, token, exitProvider, errorProvider, outputProvider) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < CONNECT_TIMEOUT_MS) {
    const spawnError = errorProvider();
    if (spawnError) {
      throw new Error(`codex app-server failed to start: ${spawnError.message}\n${outputProvider()}`);
    }
    const exited = exitProvider();
    if (exited) {
      throw new Error(`codex app-server exited before WebSocket connect (${formatExit(exited)}): ${outputProvider()}`);
    }

    try {
      return await openWebSocket(url, token);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(`Timed out connecting to ${url}: ${lastError?.message ?? "unknown error"}\n${outputProvider()}`);
}

function openWebSocket(url, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket open timed out for ${url}`));
    }, 1000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function collectMessages(ws) {
  const state = {
    received: [],
    waiters: []
  };
  ws.on("message", (data) => {
    const message = JSON.parse(String(data));
    state.received.push(message);
    for (const waiter of [...state.waiters]) {
      if (waiter.match(message)) {
        waiter.resolve(message);
        state.waiters.splice(state.waiters.indexOf(waiter), 1);
      }
    }
  });
  return state;
}

function waitForResponse(messages, id, timeoutMs) {
  const existing = messages.received.find((message) => message.id === id);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      match: (message) => message.id === id,
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      }
    };
    const timer = setTimeout(() => {
      messages.waiters.splice(messages.waiters.indexOf(waiter), 1);
      reject(new Error(`Timed out waiting for Codex app-server response ${id}`));
    }, timeoutMs);
    messages.waiters.push(waiter);
  });
}

function validateInitializeResponse(response, expectedCodexHome) {
  if (response.error) {
    throw new Error(`Codex app-server initialize failed: ${JSON.stringify(response.error)}`);
  }
  if (!response.result || typeof response.result !== "object") {
    throw new Error(`Codex app-server initialize returned no result: ${JSON.stringify(response)}`);
  }
  for (const key of ["userAgent", "codexHome", "platformFamily", "platformOs"]) {
    if (typeof response.result[key] !== "string" || response.result[key].length === 0) {
      throw new Error(`Codex app-server initialize result is missing ${key}: ${JSON.stringify(response.result)}`);
    }
  }
  if (path.resolve(response.result.codexHome) !== path.resolve(expectedCodexHome)) {
    throw new Error(`Codex app-server used unexpected CODEX_HOME: ${response.result.codexHome}`);
  }
}

function assertNoPromptOrTurnSent(methods) {
  const forbidden = methods.filter((method) => method === "thread/start" || method === "turn/start");
  if (forbidden.length > 0) {
    throw new Error(`Smoke script must not send prompt or turn methods: ${forbidden.join(", ")}`);
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    signalChild(child, "SIGTERM");
    return;
  }
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });
  signalChild(child, "SIGTERM");
  const stopped = await Promise.race([exited.then(() => true), delay(2000).then(() => false)]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    signalChild(child, "SIGKILL");
    await exited;
  }
}

async function closeWebSocket(ws) {
  if (!ws) {
    return;
  }
  if (ws.readyState === WebSocket.CLOSED) {
    return;
  }
  const closed = new Promise((resolve) => {
    ws.once("close", resolve);
  });
  ws.terminate();
  await Promise.race([closed, delay(1000)]);
}

function signalChild(child, signal) {
  if (!child.pid) {
    return;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  }
  try {
    child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

function formatExit(exit) {
  return `code=${exit.code ?? "null"} signal=${exit.signal ?? "null"}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMainModule() {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) {
  if (!existsSync(workspaceRoot)) {
    throw new Error(`Workspace root does not exist: ${workspaceRoot}`);
  }
  try {
    const result = await runCodexAppServerSmoke({
      root: process.env.OPENFORGE_CODEX_APP_SERVER_SMOKE_ROOT
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
