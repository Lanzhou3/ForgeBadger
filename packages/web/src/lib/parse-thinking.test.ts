import { describe, expect, it } from "vitest";

import { parseThinkingContent } from "@/lib/parse-thinking";

describe("parseThinkingContent", () => {
  it("passes plain text through untouched", () => {
    expect(parseThinkingContent("你好，世界")).toEqual({
      text: "你好，世界",
      thinking: "",
      thinkingOpen: false,
    });
  });

  it("splits a leading think block from the answer", () => {
    expect(parseThinkingContent("<think>先分析问题</think>答案在这里")).toEqual({
      text: "答案在这里",
      thinking: "先分析问题",
      thinkingOpen: false,
    });
  });

  it("handles a think block in the middle of the text", () => {
    const result = parseThinkingContent("前文<think>推理</think>后文");
    expect(result.text).toBe("前文后文");
    expect(result.thinking).toBe("推理");
    expect(result.thinkingOpen).toBe(false);
  });

  it("handles a think block at the very end", () => {
    const result = parseThinkingContent("正文<think>尾巴推理</think>");
    expect(result.text).toBe("正文");
    expect(result.thinking).toBe("尾巴推理");
    expect(result.thinkingOpen).toBe(false);
  });

  it("concatenates multiple think blocks", () => {
    const result = parseThinkingContent("<think>第一段</think>中间<think>第二段</think>结尾");
    expect(result.text).toBe("中间结尾");
    expect(result.thinking).toBe("第一段\n第二段");
    expect(result.thinkingOpen).toBe(false);
  });

  it("treats everything after an unterminated <think> as still-streaming reasoning", () => {
    const result = parseThinkingContent("<think>还在推理");
    expect(result.text).toBe("");
    expect(result.thinking).toBe("还在推理");
    expect(result.thinkingOpen).toBe(true);
  });

  it("keeps body text before an unterminated think block", () => {
    const result = parseThinkingContent("先说一点<think>然后继续推理");
    expect(result.text).toBe("先说一点");
    expect(result.thinking).toBe("然后继续推理");
    expect(result.thinkingOpen).toBe(true);
  });

  it("handles an empty think block", () => {
    const result = parseThinkingContent("<think></think>正文");
    expect(result.text).toBe("正文");
    expect(result.thinking).toBe("");
    expect(result.thinkingOpen).toBe(false);
  });

  it("leaves a stray closing tag as plain text", () => {
    const result = parseThinkingContent("没有开头</think>的内容");
    expect(result.text).toBe("没有开头</think>的内容");
    expect(result.thinking).toBe("");
    expect(result.thinkingOpen).toBe(false);
  });

  it("returns empty fields for empty input", () => {
    expect(parseThinkingContent("")).toEqual({ text: "", thinking: "", thinkingOpen: false });
  });
});
