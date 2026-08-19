import { Fragment, useCallback, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Lightweight Markdown renderer for config-file previews.
 *
 * Deliberately dependency-free and conservative: it emits React elements only
 * (no `dangerouslySetInnerHTML`), so raw HTML in the source is shown as plain
 * text and cannot execute. Supports the constructs commonly found in project
 * instruction files: headings, paragraphs, unordered/ordered lists, blockquote,
 * fenced code blocks, inline code, bold, italic, links, and hr.
 */

interface InlinePart {
  text: string;
  kind: "text" | "code" | "bold" | "italic" | "link";
  href?: string;
}

const inlinePattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/gu;

const safeLinkHref = (href: string): string | undefined => {
  try {
    const protocol = new URL(href, "https://example.invalid").protocol;
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      return href;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export function splitInlineMarkdown(source: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let cursor = 0;
  for (const match of source.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ text: source.slice(cursor, index), kind: "text" });
    }
    const [full, code, bold, italic, link] = match;
    if (code) {
      parts.push({ text: code.slice(1, -1), kind: "code" });
    } else if (bold) {
      parts.push({ text: bold.slice(2, -2), kind: "bold" });
    } else if (italic) {
      parts.push({ text: italic.slice(1, -1), kind: "italic" });
    } else if (link) {
      const matchHref = link.match(/\[([^\]]+)\]\(([^)\s]+)\)/u);
      if (matchHref) {
        parts.push({ text: matchHref[1]!, kind: "link", href: safeLinkHref(matchHref[2]!) });
      } else {
        parts.push({ text: full, kind: "text" });
      }
    }
    cursor = index + full.length;
  }
  if (cursor < source.length) {
    parts.push({ text: source.slice(cursor), kind: "text" });
  }
  return parts;
}

function renderInline(source: string, keyPrefix: string): ReactNode {
  const parts = splitInlineMarkdown(source);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.kind === "code") {
      return (
        <code
          key={key}
          className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {part.text}
        </code>
      );
    }
    if (part.kind === "bold") {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.text}
        </strong>
      );
    }
    if (part.kind === "italic") {
      return (
        <em key={key} className="italic">
          {part.text}
        </em>
      );
    }
    if (part.kind === "link") {
      return part.href ? (
        <a
          key={key}
          href={part.href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand underline underline-offset-2 hover:text-brand/80"
        >
          {part.text}
        </a>
      ) : (
        <Fragment key={key}>{part.text}</Fragment>
      );
    }
    return <Fragment key={key}>{part.text}</Fragment>;
  });
}

interface MarkdownLine {
  type: "heading" | "codeblock" | "list" | "quote" | "hr" | "paragraph";
  text: string;
  level?: number;
  /** Fenced-code language hint ("bash", "ts", ...); empty when the fence had no tag. */
  language?: string;
}

const fenceOpenPattern = /^```([^\s`]*)\s*$/u;

function parseLines(source: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  const rawLines = source.replace(/\r\n/gu, "\n").split("\n");

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]!;

    const fenceOpen = line.match(fenceOpenPattern);
    if (fenceOpen) {
      const language = (fenceOpen[1] ?? "").trim();
      const content: string[] = [];
      index += 1;
      while (index < rawLines.length && !rawLines[index]!.startsWith("```")) {
        content.push(rawLines[index]!);
        index += 1;
      }
      lines.push({ type: "codeblock", text: content.join("\n"), language });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      lines.push({ type: "heading", text: heading[2]!, level: heading[1]!.length });
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      lines.push({ type: "hr", text: "" });
      continue;
    }

    if (/^\s*>\s?/u.test(line)) {
      lines.push({ type: "quote", text: line.replace(/^\s*>\s?/u, "") });
      continue;
    }

    if (/^\s*(?:[-*]|\d+\.)\s+/u.test(line)) {
      lines.push({ type: "list", text: line.replace(/^\s*(?:[-*]|\d+\.)\s+/u, "") });
      continue;
    }

    if (line.trim() === "") {
      continue;
    }

    lines.push({ type: "paragraph", text: line });
  }

  return lines;
}

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  const lines = parseLines(content);
  const blocks: MarkdownLine[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length > 0) {
      blocks.push({ type: "paragraph", text: paragraphBuffer.join(" ") });
      paragraphBuffer = [];
    }
  };

  for (const line of lines) {
    if (line.type === "paragraph") {
      paragraphBuffer.push(line.text);
      continue;
    }
    flushParagraph();
    blocks.push(line);
  }
  flushParagraph();

  return (
    <div className={className ?? "space-y-3 text-sm leading-relaxed text-foreground/90"}>
      {blocks.map((block, index) => {
        const key = `md-${index}`;
        switch (block.type) {
          case "heading": {
            const level = Math.min(block.level ?? 1, 6);
            const headingClass = [
              "font-semibold text-foreground",
              level === 1 ? "text-xl" : "",
              level === 2 ? "text-lg" : "",
              level === 3 ? "text-base" : "",
              level >= 4 ? "text-sm" : ""
            ].join(" ");
            return (
              <div key={key} className={headingClass} role="heading" aria-level={level}>
                {renderInline(block.text, key)}
              </div>
            );
          }
          case "codeblock":
            return <CodeBlock key={key} text={block.text} language={block.language ?? ""} />;
          case "list":
            return (
              <div key={key} className="flex gap-2">
                <span className="text-muted-foreground">•</span>
                <span>{renderInline(block.text, key)}</span>
              </div>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-border/70 pl-3 text-muted-foreground"
              >
                {renderInline(block.text, key)}
              </blockquote>
            );
          case "hr":
            return <hr key={key} className="border-border/70" />;
          default:
            return (
              <p key={key} className="my-0">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}

/**
 * Chat-style fenced-code block: monospace body that scrolls horizontally when
 * the line is wider than its container, with a header bar that surfaces the
 * language hint (when the fence declared one) and a copy-to-clipboard button.
 * Inline markdown is intentionally NOT applied to the body — code samples
 * often contain backticks/asterisks/underscores that should render verbatim.
 */
function CodeBlock({ text, language }: { text: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard writes can be denied (permissions, sandboxed iframe). We
      // intentionally swallow the error — the user can still select+copy.
    }
  }, [text]);
  return (
    <div className="overflow-hidden rounded-md border border-border/70 bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/60 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="font-mono normal-case tracking-normal text-foreground/80">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label={copied ? "Copied" : "Copy code"}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}