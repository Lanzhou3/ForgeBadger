// Run on the affected Windows desktop: node diagnose-windows-directory-picker.mjs
// Optional: --package-dir <installed forgebadger directory>
// Opens the installed picker with stage tracing. Does not modify the package,
// read ForgeBadger credentials, or publish anything. The probe stops after 45s.
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OUTPUT_LIMIT = 64 * 1024;
const PHASES = [
  ["[Console]::OutputEncoding", "configuring-output"],
  ["Add-Type -AssemblyName System.Windows.Forms", "loading-winforms"],
  ["[System.Windows.Forms.Application]::EnableVisualStyles()", "winforms-loaded"],
  ["$owner.Show()", "showing-owner"],
  ["$dialog.ShowDialog($owner)", "opening-dialog"]
];

export function instrumentPowerShell(script) {
  for (const [anchor] of PHASES) {
    if (!script.includes(anchor)) throw new Error("Unsupported installed picker script; no probe was launched.");
  }
  const lines = script.split(/\r?\n/u).flatMap((line) => {
    const phase = PHASES.find(([anchor]) => line.includes(anchor));
    return phase ? [`[Console]::Error.WriteLine('[picker-stage] ${phase[1]}')`, line] : [line];
  });
  return [
    "[Console]::Error.WriteLine('[picker-stage] powershell-started')",
    "[Console]::Error.WriteLine('[picker-env] userInteractive=' + [Environment]::UserInteractive + '; sessionId=' + [Diagnostics.Process]::GetCurrentProcess().SessionId + '; apartment=' + [Threading.Thread]::CurrentThread.GetApartmentState() + '; languageMode=' + $ExecutionContext.SessionState.LanguageMode)",
    ...lines,
    "[Console]::Error.WriteLine('[picker-stage] script-finished')"
  ].join("\n");
}

export function runDiagnosticCommand(command, args, { timeoutMs = 45_000, write = () => {} } = {}) {
  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutNonEmpty = false;
    let timedOut = false;
    let settled = false;
    let cleanupTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      write("Probe reached its deadline; terminating only its PowerShell process.\n");
      child.kill("SIGKILL");
      cleanupTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, null, false);
      }, 1000);
    }, timeoutMs);

    child.on("spawn", () => write(`Child started: pid=${child.pid}\n`));
    child.stdout.on("data", (chunk) => { stdoutNonEmpty ||= chunk.toString("utf8").trim().length > 0; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const accepted = chunk.slice(0, Math.max(0, OUTPUT_LIMIT - stderr.length));
      stderr += accepted;
      if (accepted) write(accepted);
    });
    child.on("error", (error) => {
      stderr += error.message;
      finish(127, null, true);
    });
    child.on("close", (code, signal) => finish(code, signal, true));

    function finish(exitCode, signal, cleanupConfirmed) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      const stages = [...stderr.matchAll(/\[picker-stage\] ([a-z-]+)/gu)];
      resolveResult({
        exitCode, signal, timedOut, cleanupConfirmed,
        durationMs: Date.now() - startedAt,
        lastStage: stages.at(-1)?.[1] ?? null,
        stdoutNonEmpty, stderr
      });
    }
  });
}

export async function loadInstalledPicker(packageDir) {
  const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  if (manifest.name !== "forgebadger") throw new Error("The selected directory is not a forgebadger package.");
  const entry = join(packageDir, "dist/gateway/src/services/native-directory-picker.js");
  const { selectNativeDirectory } = await import(pathToFileURL(entry).href);
  let invocation;
  await selectNativeDirectory({
    platform: "win32",
    runner: async (command, args) => {
      invocation = { command, args: [...args] };
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });
  if (!invocation || invocation.command !== "powershell.exe") throw new Error("Unsupported installed picker command.");
  const index = invocation.args.indexOf("-EncodedCommand");
  if (index < 0 || !invocation.args[index + 1]) throw new Error("The installed picker does not use an encoded script.");
  const script = Buffer.from(invocation.args[index + 1], "base64").toString("utf16le");
  invocation.args[index + 1] = Buffer.from(instrumentPowerShell(script), "utf16le").toString("base64");
  return { version: manifest.version, ...invocation };
}

function installedPackageDirectory(args) {
  if (args.length === 2 && args[0] === "--package-dir") return resolve(args[1]);
  if (args.length !== 0) throw new Error("Usage: node diagnose-windows-directory-picker.mjs [--package-dir <path>]");
  // Fixed command text: no user-controlled values pass through cmd.exe.
  const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd root -g"], {
    encoding: "utf8", timeout: 10_000, windowsHide: true
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Could not locate the global npm package; supply --package-dir explicitly.");
  }
  return join(result.stdout.trim(), "forgebadger");
}

async function main() {
  if (process.platform !== "win32") throw new Error("Run this probe on the affected Windows desktop.");
  const picker = await loadInstalledPicker(installedPackageDirectory(process.argv.slice(2)));
  console.log(`Testing installed ForgeBadger ${picker.version}, Node ${process.version} (${process.arch}).`);
  console.log("If a folder dialog appears, cancel it. The probe closes after 45 seconds.");
  const result = await runDiagnosticCommand(picker.command, picker.args, { write: (text) => process.stdout.write(text) });
  console.log("Diagnostic result:", JSON.stringify(result, null, 2));
  process.exitCode = result.timedOut || result.exitCode !== 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
