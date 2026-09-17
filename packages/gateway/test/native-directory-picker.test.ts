import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CommandResult } from "../src/lib/dependency-check.js";
import {
  directoryPickerSupported,
  selectNativeDirectory
} from "../src/services/native-directory-picker.js";

function okResult(stdout: string): CommandResult {
  return { exitCode: 0, stdout, stderr: "" };
}

describe("native directory picker", () => {
  it("reports win32 and darwin as supported", () => {
    assert.equal(directoryPickerSupported("win32"), true);
    assert.equal(directoryPickerSupported("darwin"), true);
    assert.equal(directoryPickerSupported("linux"), false);
    assert.equal(directoryPickerSupported("freebsd"), false);
  });

  it("returns unsupported on linux without spawning anything", async () => {
    let spawned = false;
    const result = await selectNativeDirectory({
      platform: "linux",
      runner: async () => {
        spawned = true;
        return okResult("/srv/project");
      }
    });
    assert.deepEqual(result, {
      supported: false,
      reason: "Native directory picking is not supported on this platform."
    });
    assert.equal(spawned, false);
  });

  it("drives powershell FolderBrowserDialog on win32 and parses the path", async () => {
    let command: string | undefined;
    let args: string[] = [];
    const result = await selectNativeDirectory({
      platform: "win32",
      runner: async (c, a, options) => {
        command = c;
        args = a;
        assert.ok(options && options.timeoutMs !== undefined);
        return okResult("C:\\Users\\dev\\projects\\demo\n");
      }
    });
    assert.equal(command, "powershell.exe");
    assert.ok(args.includes("-STA"));
    assert.ok(args.some((arg) => arg.includes("FolderBrowserDialog")));
    assert.deepEqual(result, { supported: true, path: "C:\\Users\\dev\\projects\\demo", cancelled: false });
  });

  it("treats a cancelled Windows dialog as cancelled", async () => {
    const result = await selectNativeDirectory({
      platform: "win32",
      runner: async () => okResult("")
    });
    assert.deepEqual(result, { supported: true, cancelled: true });
  });

  it("drives osascript choose-folder on darwin and strips the trailing slash", async () => {
    let command: string | undefined;
    const result = await selectNativeDirectory({
      platform: "darwin",
      runner: async (c, args) => {
        command = c;
        assert.ok(args.some((arg) => arg.includes("choose folder")));
        return okResult("/Users/dev/projects/demo/\n");
      }
    });
    assert.equal(command, "osascript");
    assert.deepEqual(result, { supported: true, path: "/Users/dev/projects/demo", cancelled: false });
  });

  it("keeps the root path as-is on darwin", async () => {
    const result = await selectNativeDirectory({
      platform: "darwin",
      runner: async () => okResult("/\n")
    });
    assert.deepEqual(result, { supported: true, path: "/", cancelled: false });
  });

  it("treats a non-zero osascript exit as cancelled", async () => {
    const result = await selectNativeDirectory({
      platform: "darwin",
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "User canceled." })
    });
    assert.deepEqual(result, { supported: true, cancelled: true });
  });
});
