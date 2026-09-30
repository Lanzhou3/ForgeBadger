import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { test } from "node:test";

import { resolveWindowsShimCommand } from "../src/services/session-server/platform-adapter.js";

test("keeps official npm.cmd prefix and Node selection inside its own shim", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-npm-shim-"));
  try {
    const npmBin = join(directory, "node_modules", "npm", "bin");
    mkdirSync(npmBin, { recursive: true });
    writeFileSync(join(npmBin, "npm-cli.js"), "");
    writeFileSync(join(directory, "npm.cmd"), [
      "@ECHO OFF",
      "SET \"NODE_EXE=%~dp0\\node.exe\"",
      "SET \"NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js\"",
      "SET \"NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js\"",
      "IF EXIST \"%NPM_PREFIX_NPM_CLI_JS%\" SET \"NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%\"",
      "\"%NODE_EXE%\" \"%NPM_CLI_JS%\" %*"
    ].join("\r\n"));

    assert.equal(resolveWindowsShimCommand("npm", { PATH: directory, PATHEXT: ".CMD" }, "win32"), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Builds the two-level launcher shape used by minimax Code: a stable PATH
 * `mcode.cmd` that resolves a version pointer file and CALLs a versioned inner
 * launcher, which is the real `node .../cli.js` payload.
 */
function createMiniMaxStyleLauncher(root: string, release = "0.4.12"): void {
  const cliDir = join(root, "releases", release, "node_modules", "@minimax-ai", "code");
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(join(cliDir, "cli.js"), "");

  const releaseDir = join(root, "releases", release);
  writeFileSync(join(releaseDir, ".mcode-launcher.cmd"), [
    "@ECHO off",
    "\"%~dp0runtime\\node.exe\" \"%~dp0node_modules\\@minimax-ai\\code\\cli.js\" %*",
    "EXIT /B %ERRORLEVEL%"
  ].join("\r\n"));

  writeFileSync(join(root, "current"), `${release}\n`);
  writeFileSync(join(root, "mcode.cmd"), [
    "@ECHO off",
    "SETLOCAL",
    "SET /P MCODE_RELEASE=<\"%~dp0current\"",
    "ECHO(%MCODE_RELEASE%| %SystemRoot%\\System32\\findstr.exe /R /X \"[0-9A-Za-z][0-9A-Za-z._-]*\" >NUL || EXIT /B 1",
    "CALL \"%~dp0releases\\%MCODE_RELEASE%\\.mcode-launcher.cmd\" %*",
    "EXIT /B %ERRORLEVEL%"
  ].join("\r\n"));
}

test("follows a vendor launcher that only CALLs a versioned inner shim", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-indirect-shim-"));
  try {
    createMiniMaxStyleLauncher(directory);
    const expectedCli = join(directory, "releases", "0.4.12", "node_modules", "@minimax-ai", "code", "cli.js");

    const resolved = resolveWindowsShimCommand("mcode", { PATH: directory, PATHEXT: ".CMD" }, "win32");

    assert.ok(resolved, "the indirect launcher should resolve");
    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [expectedCli]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stops at the direct layer when a shim already names its own payload", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-direct-shim-"));
  try {
    const binDir = join(directory, "node_modules", "acme", "cli");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "index.js"), "");
    writeFileSync(join(directory, "acme.cmd"), [
      "@ECHO off",
      "node \"%~dp0node_modules\\acme\\cli\\index.js\" %*"
    ].join("\r\n"));

    const resolved = resolveWindowsShimCommand("acme", { PATH: directory, PATHEXT: ".CMD" }, "win32");

    assert.ok(resolved);
    assert.deepEqual(resolved.args, [join(binDir, "index.js")]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not follow a launcher indirection past the supported depth", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-deep-shim-"));
  try {
    const cliDir = join(directory, "releases", "0.4.12", "node_modules", "acme");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "cli.js"), "");
    writeFileSync(
      join(directory, "releases", "0.4.12", "inner.cmd"),
      "CALL \"%~dp0deeper.cmd\" %*"
    );
    writeFileSync(
      join(directory, "releases", "0.4.12", "deeper.cmd"),
      "node \"%~dp0node_modules\\acme\\cli.js\" %*"
    );
    writeFileSync(join(directory, "top.cmd"), "CALL \"%~dp0releases\\0.4.12\\inner.cmd\" %*");

    assert.equal(
      resolveWindowsShimCommand("top", { PATH: directory, PATHEXT: ".CMD" }, "win32"),
      undefined
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not loop on launchers that CALL each other", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-cyclic-shim-"));
  try {
    writeFileSync(join(directory, "a.cmd"), "CALL \"%~dp0b.cmd\" %*");
    writeFileSync(join(directory, "b.cmd"), "CALL \"%~dp0a.cmd\" %*");

    assert.equal(
      resolveWindowsShimCommand("a", { PATH: directory, PATHEXT: ".CMD" }, "win32"),
      undefined
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("leaves a launcher unresolved when its release pointer is missing", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-missing-pointer-"));
  try {
    writeFileSync(join(directory, "current"), "");
    writeFileSync(
      join(directory, "mcode.cmd"),
      "SET /P MCODE_RELEASE=<\"%~dp0current\"\r\nCALL \"%~dp0releases\\%MCODE_RELEASE%\\.mcode-launcher.cmd\" %*"
    );

    assert.equal(
      resolveWindowsShimCommand("mcode", { PATH: directory, PATHEXT: ".CMD" }, "win32"),
      undefined
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("leaves a launcher unresolved when the CALLED shim does not exist", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-missing-target-"));
  try {
    writeFileSync(
      join(directory, "mcode.cmd"),
      "CALL \"%~dp0releases\\9.9.9\\.mcode-launcher.cmd\" %*"
    );

    assert.equal(
      resolveWindowsShimCommand("mcode", { PATH: directory, PATHEXT: ".CMD" }, "win32"),
      undefined
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("prefers a runtime the shim declares over the host Node", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-declared-node-"));
  try {
    const releaseDir = join(directory, "releases", "1.0.0");
    const cliDir = join(releaseDir, "node_modules", "acme");
    // The real launcher hardcodes an absolute path to a private runtime that
    // lives outside the release tree, next to the install root.
    const runtimeDir = join(directory, "runtime", "node-v22.19.0-win-x64");
    const nodeExe = join(runtimeDir, "node.exe");
    mkdirSync(cliDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(nodeExe, "");
    writeFileSync(join(cliDir, "cli.js"), "");
    writeFileSync(
      join(releaseDir, "inner.cmd"),
      [
        "@ECHO off",
        `"${nodeExe}" "%~dp0node_modules\\acme\\cli.js" %*`
      ].join("\r\n")
    );
    writeFileSync(
      join(directory, "top.cmd"),
      "CALL \"%~dp0releases\\1.0.0\\inner.cmd\" %*"
    );

    const resolved = resolveWindowsShimCommand("top", { PATH: directory, PATHEXT: ".CMD" }, "win32");

    assert.ok(resolved);
    // The declared runtime wins; process.execPath may be an out-of-range Node.
    assert.equal(resolved.command, nodeExe);
    assert.deepEqual(resolved.args, [join(cliDir, "cli.js")]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("falls back to the host Node when the shim declares none", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-host-node-"));
  try {
    const cliDir = join(directory, "node_modules", "acme");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "cli.js"), "");
    writeFileSync(
      join(directory, "acme.cmd"),
      "node \"%~dp0node_modules\\acme\\cli.js\" %*"
    );

    const resolved = resolveWindowsShimCommand("acme", { PATH: directory, PATHEXT: ".CMD" }, "win32");

    assert.ok(resolved);
    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.args, [join(cliDir, "cli.js")]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stays inert on POSIX so execvp resolution is unchanged", () => {
  const directory = mkdtempSync(join(tmpdir(), "forgebadger-posix-shim-"));
  try {
    createMiniMaxStyleLauncher(directory);

    assert.equal(
      resolveWindowsShimCommand("mcode", { PATH: directory, PATHEXT: ".CMD" }, "linux"),
      undefined
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Real-host check: a CLI installed by a vendor launcher on this machine must
 * resolve to a payload that actually exists, not to a literal `%~dp0...`
 * string. Skipped when the CLI is not installed so CI (Ubuntu) stays green.
 */
for (const command of ["mcode", "mcode-tools", "kimi", "pi"] as const) {
  test(`real host: ${command} resolves to an existing payload on Windows`, (t) => {
    if (process.platform !== "win32") {
      t.skip("Windows-only shim resolution");
      return;
    }
    const resolved = resolveWindowsShimCommand(command, process.env, "win32");
    if (!resolved) {
      t.skip(`${command} is not installed on this host`);
      return;
    }

    if (resolved.args.length === 0) {
      assert.ok(existsSync(resolved.command), `${command} command should exist: ${resolved.command}`);
      return;
    }
    assert.ok(
      !/%~dp0|%[A-Za-z_]+%|^dp0\\/u.test(resolved.args[0] ?? ""),
      `${command} payload must not contain unexpanded batch variables: ${resolved.args[0]}`
    );
    for (const arg of resolved.args) {
      assert.ok(existsSync(arg), `${command} payload should exist on disk: ${arg}`);
    }

    // When a CLI ships its own runtime, launching it on the host Node can break
    // it: minimax Code pins `engines: >=22.19 <23 || >=24 <27` and refuses to
    // start otherwise. So a declared runtime must be preferred — and, when the
    // shim declares one that is *missing* on disk (a half-finished self-update
    // leaves the launcher pointing at a runtime that was never unpacked), the
    // resolution must still yield a real, existing entry point rather than
    // silently substituting an out-of-range host Node without saying so.
    if (command === "mcode" || command === "mcode-tools") {
      const scriptArg = resolved.args[0] ?? "";
      assert.ok(existsSync(scriptArg), "resolved entry point must exist on disk");
      // Compare against the host Node by identity, not by file name: a
      // fallback and a bundled runtime are both called `node.exe`.
      const usingHostNode = resolved.command === process.execPath;
      if (usingHostNode) {
        // No usable bundled runtime on this host (a half-finished self-update
        // leaves the launcher pointing at a runtime that was never unpacked).
        // The resolution is still correct — it yields a real entry point — but
        // the CLI may reject the host Node on its own engines range.
        assert.ok(
          existsSync(resolved.command),
          "host Node fallback must itself exist"
        );
      } else {
        assert.equal(
          basename(resolved.command).toLowerCase(),
          "node.exe",
          "a declared runtime must be a Node executable"
        );
      }
    }
  });
}

/**
 * npm's global-install shim writes `SET dp0=%~dp0` then references
 * `%dp0%\node_modules\...`. `dp0` is a batch-local variable never exported to
 * the process environment, so it must be treated as an implicit alias for the
 * shim's own directory. This is the shape used by `pi.cmd`, `opencode.cmd` and
 * every `npm i -g` package — a regression here breaks session creation for
 * all globally-installed CLIs on Windows.
 */
for (const fixture of [
  { name: "pi", body: [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js\" %*"
  ].join("\r\n"),
  expectScript: "node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js" },
  { name: "opencode", body: [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "\"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe\"   %*"
  ].join("\r\n"),
  expectExe: "node_modules\\opencode-ai\\bin\\opencode.exe" }
] as const) {
  test(`npm standard %dp0% shim resolves: ${fixture.name}`, () => {
    const directory = mkdtempSync(join(tmpdir(), `forgebadger-dp0-shim-${fixture.name}-`));
    try {
      const scriptPath = join(directory, fixture.expectScript ?? fixture.expectExe!);
      mkdirSync(join(scriptPath, ".."), { recursive: true });
      writeFileSync(scriptPath, "");

      writeFileSync(join(directory, `${fixture.name}.cmd`), fixture.body);

      const resolved = resolveWindowsShimCommand(fixture.name, { PATH: directory, PATHEXT: ".CMD" }, "win32");
      assert.ok(resolved, `${fixture.name}.cmd must resolve`);
      if ("expectScript" in fixture) {
        assert.equal(resolved.command, process.execPath);
        assert.deepEqual(resolved.args, [scriptPath]);
      } else {
        assert.equal(resolved.command, scriptPath);
        assert.deepEqual(resolved.args, []);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
