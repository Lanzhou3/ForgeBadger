// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownRenderer, splitInlineMarkdown } from "./markdown-renderer";

afterEach(() => {
  cleanup();
});

describe("splitInlineMarkdown", () => {
  it("splits code, bold, italic, and links", () => {
    const parts = splitInlineMarkdown("run `npm test` and **save** the *result* and see [docs](https://example.com)!");
    expect(parts).toEqual([
      { text: "run ", kind: "text" },
      { text: "npm test", kind: "code" },
      { text: " and ", kind: "text" },
      { text: "save", kind: "bold" },
      { text: " the ", kind: "text" },
      { text: "result", kind: "italic" },
      { text: " and see ", kind: "text" },
      { text: "docs", kind: "link", href: "https://example.com" },
      { text: "!", kind: "text" }
    ]);
  });

  it("rejects unsafe link protocols", () => {
    const parts = splitInlineMarkdown("[x](javascript:alert(1))");
    const link = parts.find((part) => part.kind === "link")!;
    expect(link.href).toBeUndefined();
  });

  it("passes mailto links through", () => {
    const parts = splitInlineMarkdown("[mail](mailto:dev@example.com)");
    const link = parts.find((part) => part.kind === "link")!;
    expect(link.href).toBe("mailto:dev@example.com");
  });
});

describe("MarkdownRenderer", () => {
  it("renders headings, lists, code blocks, and inline formatting", () => {
    render(
      <MarkdownRenderer
        content={'# Title\n\n- item one\n- item two\n\n```bash\necho hi\n```\n\nSee `code` and **bold**.'}
      />
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Title");
    expect(screen.getByText("item one")).toBeTruthy();
    expect(screen.getByText("item two")).toBeTruthy();
    expect(screen.getByText("echo hi")).toBeTruthy();
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("bold")).toBeTruthy();
  });

  it("surfaces the fenced-code language and renders a copy control", () => {
    render(<MarkdownRenderer content={"```ts\nconst x = 1;\n```"} />);
    expect(screen.getByText("ts")).toBeTruthy();
    expect(screen.getByText("const x = 1;")).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy code/i })).toBeTruthy();
  });

  it("does not parse inline markdown inside a code block", () => {
    render(<MarkdownRenderer content={"```\n*not bold* `not code`\n```"} />);
    // The code body's verbatim text should appear; it must not be split into
    // italic + code parts the way inline markdown would split it.
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("*not bold* `not code`");
  });

it("does not render raw HTML as markup", () => {
    render(<MarkdownRenderer content={"<script>alert(1)</script>\n\nplain <b>text"} />);
    expect(screen.queryByText("alert(1)")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/u)).toBeTruthy();
  });

  it("renders safe links as anchors and unsafe ones as plain text", () => {
    const { container } = render(
      <MarkdownRenderer content={'[safe](https://example.com) and [bad](javascript:alert(1))'} />
    );
    const safeLink = screen.getByText("safe");
    expect(safeLink.tagName).toBe("A");
    expect(safeLink.getAttribute("href")).toBe("https://example.com");
    const unsafeAnchor = container.querySelector('a[href="javascript:alert(1)"]');
    expect(unsafeAnchor).toBeNull();
    expect(container.textContent).toContain("bad");
  });

  it("merges consecutive paragraph lines with a space", () => {
    render(<MarkdownRenderer content={"first line\nsecond line"} />);
    expect(screen.getByText("first line second line")).toBeTruthy();
  });
});