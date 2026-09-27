import { expect, test, type Page } from "@playwright/test";

const SESSION_ID = "selection-test";
const TEXT = "Copy selection regression line";

/** Real TerminalView/xterm, with only the Gateway HTTP/WS boundary substituted. */
async function openMouseReportingTerminal(page: Page, platform: string) {
  const inputs: string[] = [];
  const errors: string[] = [];
  const size = { cols: 80, rows: 24 };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript((platform) => {
    Object.defineProperty(navigator, "platform", { value: platform });
    localStorage.setItem("forgebadger.token", "terminal-selection-test");
    localStorage.setItem("forgebadger.user", JSON.stringify({
      id: "ui-test", email: "ui@example.test", role: "admin", status: "active",
    }));
    localStorage.setItem("forgebadger-language", "en");
  }, platform);
  const session = {
    id: SESSION_ID, projectId: "selection-project", aiTool: "codex",
    name: "Codex selection QA", status: "running", attachToken: "ui-attach-test",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: object = {};
    if (path === "/api/v1/auth/me") {
      data = { id: "ui-test", email: "ui@example.test", role: "admin", status: "active" };
    } else if (path === `/api/v1/sessions/${SESSION_ID}` || path.endsWith("/connect")) {
      data = { session };
    } else if (path.endsWith("/writer")) {
      data = { mode: "manual" };
    } else if (path === "/api/v1/sessions") {
      data = { sessions: [session] };
    } else if (path.includes("task-packets")) {
      data = { taskPackets: [] };
    } else if (path.includes("notifications")) {
      data = { notifications: [], unreadCount: 0 };
    } else if (path.includes("cli-accounts")) {
      data = { overview: { adapter: "codex", status: "not_configured", quota: null } };
    } else if (path.includes("git")) {
      data = { git: { isGitRepo: false, files: [] } };
    } else if (path.includes("project")) {
      data = { project: { id: "selection-project", name: "Terminal QA", rootPath: "/tmp/terminal-qa" } };
    }
    await route.fulfill({ json: { code: 0, data, message: "" } });
  });
  await page.routeWebSocket("**/ws/**", (socket) => {
    if (!socket.url().includes("/terminal/")) return;
    let sent = false;
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.type === "terminal_input") inputs.push(frame.payload.data);
      if (frame.type === "terminal_resize") Object.assign(size, frame.payload);
      if (sent) return;
      sent = true;
      socket.send(JSON.stringify({
        type: "terminal_history",
        payload: {
          sequence: 1,
          data: `\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[H${TEXT}\r\nSecond line for mouse drag`,
        },
      }));
    });
  });
  await page.goto(`/sessions/${SESSION_ID}?attachToken=ui-attach-test`);
  await expect(page.locator(".xterm.enable-mouse-events")).toBeVisible();
  await expect(page.getByTestId("terminal-host")).toHaveAttribute("title", /Hold Shift/);
  await expect.poll(() => size.cols).toBeGreaterThan(80);
  return { inputs, errors, size };
}

for (const platform of ["MacIntel", "Win32"]) {
  test(`selects and copies with mouse reporting on ${platform}`, async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { inputs, errors, size } = await openMouseReportingTerminal(page, platform);
    const box = await page.locator(".xterm-screen").boundingBox();
    expect(box).not.toBeNull();
    const cellWidth = box!.width / size.cols;
    const x = box!.x + cellWidth * 0.1;
    const y = box!.y + 8;

    // Ordinary clicks and transcript scrolling must still reach Codex.
    await page.mouse.click(x, y);
    await expect.poll(() => inputs.some((data) => /\x1b\[<0;/.test(data))).toBe(true);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => inputs.some((data) => /\x1b\[<64;/.test(data))).toBe(true);
    inputs.length = 0;

    // Modifier + drag belongs to the browser selection, never the CLI.
    const modifier = "Shift";
    await page.evaluate(() => navigator.clipboard.writeText("selection-not-copied"));
    await page.mouse.move(x, y);
    await page.keyboard.down(modifier);
    await page.mouse.down();
    await page.mouse.move(x + TEXT.length * cellWidth, y, { steps: 15 });
    await page.mouse.up();
    await page.keyboard.up(modifier);
    await expect(page.locator(".xterm-selection div")).not.toHaveCount(0);
    // Hover reports from moving to the starting cell are allowed; button
    // presses/drags/releases for the selection must not reach the process.
    expect(inputs.filter((data) => {
      const report = /\x1b\[<(\d+);/.exec(data);
      return report && (Number(report[1]) & 3) === 0;
    })).toEqual([]);
    await page.keyboard.press(platform === "MacIntel" ? "Meta+c" : "Control+c");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(TEXT);
    expect(inputs).not.toContain("\x03");
    expect(errors).toEqual([]);
  });
}

async function emulateSafari(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
    });
  });
}

test("forwards Codex question shortcuts as distinct modified keys on macOS", async ({ page }) => {
  const { inputs, errors } = await openMouseReportingTerminal(page, "MacIntel");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => inputs).toEqual(["\x1b[1;3A"]);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(() => inputs).toEqual(["\x1b[1;3A", "\x1b[1;2D"]);
  await page.keyboard.press("Alt+ArrowDown");
  await page.keyboard.press("Control+ArrowUp");
  await expect.poll(() => inputs).toEqual([
    "\x1b[1;3A", "\x1b[1;2D", "\x1b[1;3B", "\x1b[1;5A",
  ]);
  expect(errors).toEqual([]);
});

test("sends the first shifted character when Safari IME input precedes keydown", async ({ page }) => {
  await emulateSafari(page);
  const { inputs, errors } = await openMouseReportingTerminal(page, "MacIntel");
  const textarea = page.locator(".xterm-helper-textarea");
  await textarea.focus();

  // Safari + IME can deliver committed text before the character keydown,
  // while xterm still remembers the preceding Shift keydown (#5374).
  let expected = "";
  for (const [key, code, modifier] of [["?", "Slash", "Shift"], ["+", "Equal", "Shift"], ["!", "Digit1", "Shift"], ["A", "KeyA", "CapsLock"]]) {
    await textarea.evaluate((element, { key, code, modifier }) => {
      const target = element as HTMLTextAreaElement;
      const keyboard = { bubbles: true, cancelable: true, shiftKey: true };
      target.dispatchEvent(new KeyboardEvent("keydown", { ...keyboard, key: modifier, keyCode: modifier === "Shift" ? 16 : 20 }));
      const input = { bubbles: true, composed: true, data: key, inputType: "insertText" };
      target.dispatchEvent(new InputEvent("beforeinput", { ...input, cancelable: true }));
      target.value += key;
      target.dispatchEvent(new InputEvent("input", input));
      target.dispatchEvent(new KeyboardEvent("keydown", { ...keyboard, key, code, keyCode: 229 }));
      target.dispatchEvent(new KeyboardEvent("keyup", { ...keyboard, key, code, keyCode: 191 }));
      target.dispatchEvent(new KeyboardEvent("keyup", { ...keyboard, key: modifier, keyCode: modifier === "Shift" ? 16 : 20, shiftKey: false }));
    }, { key: key!, code: code!, modifier: modifier! });
    expected += key;
    await expect.poll(() => inputs.join("")).toBe(expected);
  }
  // A second press must arrive once too, with no stale input left over.
  await page.keyboard.press("Shift+?");
  await expect.poll(() => inputs.join("")).toBe("?+!A?");
  expect(errors).toEqual([]);
  await page.screenshot({ path: "/tmp/forgebadger-terminal-keyboard.png" });
});

for (const browser of ["chromium", "safari"]) {
  test(`preserves ordinary typing and Chinese composition with ${browser} input handling`, async ({ page }) => {
    if (browser === "safari") await emulateSafari(page);
    const { inputs, errors } = await openMouseReportingTerminal(page, "MacIntel");
    const textarea = page.locator(".xterm-helper-textarea");
    await textarea.focus();
    await page.keyboard.type("abc");
    for (const key of ["?", "+", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "A"]) {
      await page.keyboard.press(`Shift+${key}`);
    }
    await page.keyboard.press("Control+c");
    const expected = "abc?+!@#$%^&*()_A\x03";
    await expect.poll(() => inputs.join("")).toBe(expected);

    // Use real xterm composition handling; only OS IME events are replayed.
    await textarea.evaluate(async (element) => {
      const target = element as HTMLTextAreaElement;
      target.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Shift", keyCode: 16, shiftKey: true }));
      target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true, inputType: "insertText", data: "中文", isComposing: true }));
      target.value += "中文";
      target.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "中文" }));
      target.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertCompositionText", data: "中文", isComposing: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      target.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
      target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift", keyCode: 16 }));
    });
    await expect.poll(() => inputs.join("")).toBe(`${expected}中文`);
    await page.keyboard.type("ok");
    await expect.poll(() => inputs.join("")).toBe(`${expected}中文ok`);
    expect(errors).toEqual([]);
  });
}
