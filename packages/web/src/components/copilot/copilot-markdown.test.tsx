// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  CopilotMarkdown,
  StreamingCopilotMarkdown,
  closeOpenMarkdown,
} from "@/components/copilot/copilot-markdown";

vi.mock("@/components/projects/workspace/highlight", () => ({
  // Grammar loading is exercised by the workspace viewer tests; here the chat
  // renderer must degrade to plain text when highlighting is unavailable.
  highlightWorkspaceCode: vi.fn().mockResolvedValue(null),
  tokenFontStyle: vi.fn().mockReturnValue({ italic: false, bold: false, underline: false }),
}));

describe("CopilotMarkdown", () => {
  beforeEach(() => {
    cleanup();
  });

  describe("gfm structures", () => {
    it("renders tables as real table elements with headers and cells", () => {
      const { container } = render(
        <CopilotMarkdown content={"| 模型 | 状态 |\n| --- | --- |\n| claude | 可用 |"} />
      );

      const table = screen.getByRole("table");
      expect(table).toBeTruthy();
      expect(container.querySelectorAll("th")).toHaveLength(2);
      expect(screen.getByText("模型")).toBeTruthy();
      expect(screen.getByText("claude")).toBeTruthy();
      expect(table.parentElement?.className).toContain("overflow-x-auto");
    });

    it("renders ordered lists with semantic ol/li instead of bullet divs", () => {
      const { container } = render(<CopilotMarkdown content={"1. 第一步\n2. 第二步\n3. 第三步"} />);

      expect(container.querySelector("ol")).toBeTruthy();
      expect(container.querySelectorAll("li")).toHaveLength(3);
      expect(screen.getByText("第二步")).toBeTruthy();
      // Numbers come from CSS list-style; the raw digit markers must be gone.
      expect(screen.queryByText(/^1\.\s/u)).toBeNull();
    });

    it("renders nested unordered lists", () => {
      const content = "- 顶层 A\n- 顶层 B\n  - 嵌套 B1\n  - 嵌套 B2";
      const { container } = render(<CopilotMarkdown content={content} />);

      expect(screen.getByText("顶层 A")).toBeTruthy();
      expect(screen.getByText("嵌套 B1")).toBeTruthy();
      expect(container.querySelectorAll("ul").length).toBeGreaterThanOrEqual(2);
    });

    it("renders task lists as styled checkboxes with checked state", () => {
      const { container } = render(<CopilotMarkdown content={"- [x] 已完成项\n- [ ] 待办项"} />);

      expect(screen.getByText("已完成项")).toBeTruthy();
      expect(screen.getByText("待办项")).toBeTruthy();
      // Checked task shows the lucide check glyph; unchecked does not.
      expect(container.querySelector("svg.lucide-check")).toBeTruthy();
    });

    it("renders strikethrough as a del element", () => {
      const { container } = render(<CopilotMarkdown content={"~~过时方案~~ 已废弃"} />);

      expect(container.querySelector("del")?.textContent).toBe("过时方案");
    });
  });

  describe("link safety", () => {
    it("opens http links in a new tab with noopener", () => {
      render(<CopilotMarkdown content={"[文档](https://example.com/docs)"} />);

      const link = screen.getByText("文档");
      expect(link.getAttribute("href")).toBe("https://example.com/docs");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    });

    it("strips javascript: URLs instead of rendering them", () => {
      render(<CopilotMarkdown content={"[点击](javascript:alert(1))"} />);

      const link = screen.getByText("点击");
      expect(link.tagName).toBe("A");
      // react-markdown empties disallowed URLs; the scheme must never survive.
      const href = link.getAttribute("href");
      expect(href === null || href === "").toBe(true);
    });
  });

  describe("raw html is inert", () => {
    it("never mounts model-supplied HTML elements — they stay escaped text", () => {
      const { container } = render(
        <CopilotMarkdown content={'hello <img src=x onerror="alert(1)"> world'} />
      );

      // No element is mounted; the payload only survives as escaped text,
      // so the browser can never execute it.
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
      const paragraph = container.querySelector("p");
      expect(paragraph?.textContent).toContain("<img src=x");
    });
  });

  describe("code blocks", () => {
    it("renders fenced code with a language label and a copy affordance", () => {
      render(<CopilotMarkdown content={"```ts\nconst a = 1;\n```"} />);

      expect(screen.getByText("ts")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
      expect(screen.getByText(/const a = 1;/u)).toBeTruthy();
    });

    it("renders inline code as a mono chip", () => {
      const { container } = render(<CopilotMarkdown content={"运行 `pnpm build` 即可"} />);

      const inlineCode = container.querySelector("p > code");
      expect(inlineCode?.textContent).toBe("pnpm build");
      expect(inlineCode?.className).toContain("font-mono");
    });
  });

  describe("images", () => {
    it("renders remote images as links instead of loading them", () => {
      render(<CopilotMarkdown content={"![截图](https://example.com/a.png)"} />);

      expect(screen.queryByRole("img")).toBeNull();
      const link = screen.getByText("截图");
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe("https://example.com/a.png");
    });
  });
});

describe("closeOpenMarkdown", () => {
  it("closes an unterminated fenced code block", () => {
    const result = closeOpenMarkdown("```ts\nconst a = 1;");
    expect(result.endsWith("\n```")).toBe(true);
    expect((result.match(/```/gu) ?? []).length % 2).toBe(0);
  });

  it("leaves balanced fences untouched", () => {
    const source = "```ts\nconst a = 1;\n```\ndone";
    expect(closeOpenMarkdown(source)).toBe(source);
  });

  it("closes an unterminated inline code span", () => {
    expect(closeOpenMarkdown("run `pnpm build")).toBe("run `pnpm build`");
  });

  it("closes dangling bold emphasis at end of stream", () => {
    expect(closeOpenMarkdown("这是 **重点")).toBe("这是 **重点**");
    expect(closeOpenMarkdown("这是 *重点")).toBe("这是 *重点*");
  });

  it("does not append a closing fence after the just-closed fence line", () => {
    // The appended fence line itself must not trip the backtick pass.
    const result = closeOpenMarkdown("```ts\nconst a = `x;");
    expect(result).toBe("```ts\nconst a = `x;\n```");
  });
});

describe("StreamingCopilotMarkdown", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders a partially streamed code block as a block, not raw syntax", () => {
    // JSX string attributes keep \n literal — expression form is required
    // for real newlines in multi-line fixtures.
    render(<StreamingCopilotMarkdown text={"看这个：\n```bash\npnpm test"} />);

    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getByText(/pnpm test/u)).toBeTruthy();
  });

  it("renders plain partial text without mangling it", () => {
    render(<StreamingCopilotMarkdown text="正在生成 **加粗** 与后续" />);

    expect(screen.getByText(/正在生成/u)).toBeTruthy();
  });
});
