import { describe, expect, it } from "vitest";

import { createTerminalPromptCapture } from "./terminal-prompt-capture";

describe("terminal prompt capture", () => {
  it("captures a typed line on Enter", () => {
    const capture = createTerminalPromptCapture();
    expect(capture.push("帮我修一下")).toBeNull();
    expect(capture.push("登录页的样式")).toBeNull();
    expect(capture.push("\r")).toBe("帮我修一下登录页的样式");
  });

  it("applies backspace before finalizing", () => {
    const capture = createTerminalPromptCapture();
    capture.push("fixx");
    capture.push("\x7f");
    expect(capture.push("\r")).toBe("fix");
  });

  it("ignores arrow-key escape sequences", () => {
    const capture = createTerminalPromptCapture();
    capture.push("git status");
    capture.push("\x1b[A"); // arrow up
    capture.push("\x1b[D"); // arrow left
    expect(capture.push("\r")).toBe("git status");
  });

  it("ignores SS3 application-cursor arrow sequences", () => {
    const capture = createTerminalPromptCapture();
    capture.push("git status");
    capture.push("\x1bOA\x1bOB\x1bOC\x1bOD");
    expect(capture.push("\r")).toBe("git status");
  });

  it("ignores escape sequences split across input chunks", () => {
    const capture = createTerminalPromptCapture();
    capture.push("\x1b[");
    capture.push("A");
    capture.push("\x1bO");
    capture.push("B");
    expect(capture.push("\r")).toBeNull();
  });

  it("ignores OSC query responses echoed by the terminal", () => {
    const capture = createTerminalPromptCapture();
    capture.push("\x1b]10;rgb:e5e5/eded/f7f7\x1b\\"); // OSC 10 color report (ST)
    capture.push("\x1b]4;1;rgb:5050/7b7b/4b4b\x07"); // OSC 4 palette report (BEL)
    expect(capture.push("git status\r")).toBe("git status");
  });

  it("ignores DCS/APC string sequences (kitty protocol, termcap)", () => {
    const capture = createTerminalPromptCapture();
    capture.push("\x1bP+q544f795a\x1b\\"); // DCS termcap response
    capture.push("\x1b_Gi=1,a=t,f=32;AABBBCCC\x1b\\"); // APC kitty graphics response
    expect(capture.push("修一下样式\r")).toBe("修一下样式");
  });

  it("ignores too-short lines", () => {
    const capture = createTerminalPromptCapture();
    expect(capture.push("y\r")).toBeNull();
    expect(capture.push("\r")).toBeNull();
  });

  it("captures pasted text ending with a newline", () => {
    const capture = createTerminalPromptCapture();
    expect(capture.push("解释一下这个报错\r\n")).toBe("解释一下这个报错");
  });

  it("caps the captured length", () => {
    const capture = createTerminalPromptCapture(10);
    capture.push("a] very long prompt text here");
    expect(capture.push("\r")).toBe("a] very lo");
  });

  it("resets the buffer after finalizing", () => {
    const capture = createTerminalPromptCapture();
    capture.push("first\r");
    expect(capture.push("second\r")).toBe("second");
  });
});
