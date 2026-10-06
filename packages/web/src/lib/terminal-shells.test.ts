import { describe, expect, it } from "vitest";

import {
  defaultTerminalShellForPlatform,
  pickAvailableShell,
  platformShellOrder
} from "@/lib/terminal-shells";

describe("platformShellOrder", () => {
  it("prefers pwsh on Windows (5.1 and cmd always exist as fallbacks)", () => {
    expect(platformShellOrder(true)).toEqual(["pwsh", "powershell", "cmd"]);
  });

  it("prefers the system shell on POSIX", () => {
    expect(platformShellOrder(false)).toEqual(["sh", "bash", "zsh"]);
  });
});

describe("defaultTerminalShellForPlatform", () => {
  it("defaults to pwsh on Windows and sh on POSIX", () => {
    expect(defaultTerminalShellForPlatform(true)).toBe("pwsh");
    expect(defaultTerminalShellForPlatform(false)).toBe("sh");
  });
});

describe("pickAvailableShell", () => {
  it("keeps the current selection while it is installed", () => {
    expect(
      pickAvailableShell("pwsh", ["pwsh", "powershell", "cmd"], ["pwsh", "powershell", "cmd"])
    ).toBe("pwsh");
    expect(
      pickAvailableShell("powershell", ["pwsh", "powershell", "cmd"], ["powershell", "cmd"])
    ).toBe("powershell");
  });

  it("falls back to the first installed shell in platform order", () => {
    // Windows without PowerShell 7: the pwsh default falls back to 5.1.
    expect(
      pickAvailableShell("pwsh", ["pwsh", "powershell", "cmd"], ["powershell", "cmd"])
    ).toBe("powershell");
    // No pwsh and no 5.1 (rare): cmd is the last resort.
    expect(
      pickAvailableShell("pwsh", ["pwsh", "powershell", "cmd"], ["cmd"])
    ).toBe("cmd");
    // POSIX without zsh: the zsh selection falls back to the system shell.
    expect(pickAvailableShell("zsh", ["sh", "bash", "zsh"], ["sh"])).toBe("sh");
  });

  it("is a no-op while availability is unknown (probe failed / pending)", () => {
    expect(pickAvailableShell("pwsh", ["pwsh", "powershell", "cmd"], null)).toBe("pwsh");
    expect(
      pickAvailableShell("pwsh", ["pwsh", "powershell", "cmd"], [])
    ).toBe("pwsh");
  });

  it("uses an installed Gateway shell when browser and host platforms differ", () => {
    expect(pickAvailableShell("cmd", ["pwsh", "powershell", "cmd"], ["bash", "zsh"])).toBe("bash");
  });
});
