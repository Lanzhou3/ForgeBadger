"use client";

import { isValidElement, memo, useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ThemedToken } from "shiki";

import { highlightWorkspaceCode, tokenFontStyle } from "@/components/projects/workspace/highlight";
import { cn } from "@/lib/utils";

/**
 * Chat-oriented markdown renderer for Copilot messages (robot widget panel and
 * full console). Follows the industry-standard AI-chat pipeline:
 *
 * - `react-markdown` + `remark-gfm`: GitHub-flavored tables, task lists,
 *   strikethrough, autolinks, ordered/unordered/nested lists — rendered as
 *   React elements (no dangerouslySetInnerHTML), so model output is XSS-safe
 *   by construction; raw HTML in model output is never executed.
 * - URL scheme allow-list (http/https/mailto) via a custom urlTransform.
 * - Streaming tolerance: while tokens are still arriving, obviously unfinished
 *   structures (unclosed fences, dangling emphasis) are closed for rendering
 *   only so partial output doesn't flash raw syntax.
 * - Code blocks reuse the workspace viewer's lazy Shiki singleton for syntax
 *   highlighting, with a language label and copy-to-clipboard affordance.
 * - Images are rendered as links: model-supplied remote URLs must not trigger
 *   automatic network requests or tracking-pixel loads.
 */

/**
 * Heuristic preprocessor for streaming input only: closes structures that are
 * obviously unfinished so partial markdown renders as its final shape instead
 * of raw syntax. Not a parser — it is skipped entirely once streaming ends.
 */
export function closeOpenMarkdown(text: string): string {
  let out = text;

  // Close an unterminated fenced code block (odd number of ``` markers).
  const fenceCount = (out.match(/```/gu) ?? []).length;
  if (fenceCount % 2 === 1) out += "\n```";

  // Close unterminated inline code spans (odd backtick count on a line),
  // skipping lines inside fences — their content is verbatim code.
  let insideFence = false;
  out = out
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) return line;
      const ticks = (line.match(/`/gu) ?? []).length;
      return ticks % 2 === 1 ? `${line}\`` : line;
    })
    .join("\n");

  // Close dangling bold emphasis: an odd number of ** markers means one pair
  // is still open mid-stream (e.g. "这是 **重点").
  if ((out.match(/\*\*/gu) ?? []).length % 2 === 1) {
    out += "**";
  } else {
    // Otherwise close dangling italic: an odd number of remaining single *.
    const singleStars = out.replace(/\*\*/gu, "").match(/\*/gu)?.length ?? 0;
    if (singleStars % 2 === 1) out += "*";
  }

  return out;
}

/** Allow only http(s)/mailto URLs; anything else is stripped by react-markdown. */
function safeUrl(url: string): string {
  try {
    const protocol = new URL(url, "https://example.invalid").protocol;
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") return url;
  } catch {
    return "";
  }
  return "";
}

/** Recursively flatten a React node tree to plain text (for code extraction). */
function flattenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement(node)) {
    return flattenText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

const markdownComponents: Components = {
  // No vertical margins on blocks: the wrapper owns one consistent rhythm
  // between top-level blocks (and tightens it after headings), so a paragraph,
  // list, table and code block all sit on the same 16px baseline grid instead
  // of stacking their own margins on top of the container's gap.
  h1: ({ children }) => <h1 className="text-lg leading-snug font-semibold tracking-tight text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base leading-snug font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-foreground">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold text-foreground/90">{children}</h4>,
  h5: ({ children }) => <h5 className="text-sm font-semibold text-foreground/90">{children}</h5>,
  h6: ({ children }) => <h6 className="text-sm font-semibold text-muted-foreground">{children}</h6>,
  p: ({ children }) => <p className="my-0 leading-[1.7]">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-brand underline underline-offset-2 hover:text-brand/80"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-0 list-disc space-y-1 ps-5 marker:text-muted-foreground/60 [&>li>p]:my-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-0 list-decimal space-y-1 ps-5 marker:text-muted-foreground/60 [&>li>p]:my-0">{children}</ol>
  ),
  li: ({ children, className }) => (
    <li className={cn("leading-[1.7]", className?.includes("task-list-item") && "list-none")}>{children}</li>
  ),
  input: ({ checked, type }) =>
    type === "checkbox" ? (
      <span
        aria-hidden="true"
        className={cn(
          "me-1.5 inline-flex size-3.5 translate-y-[2px] shrink-0 items-center justify-center rounded border",
          checked ? "border-brand bg-brand text-brand-foreground" : "border-border bg-background"
        )}
      >
        {checked ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
    ) : null,
  blockquote: ({ children }) => (
    <blockquote className="my-0 border-l-2 border-border/70 ps-3 text-muted-foreground [&>*]:my-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-0 border-border/60" />,
  // Tables: hairline header rule + row separators instead of a full cell grid,
  // 13px cells with roomier padding so multi-line conclusions stay readable.
  // Headers never wrap (a column title breaking mid-word is what made the old
  // four-column tables unreadable); the wrapper scrolls when content overflows.
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-[13px] [&_tbody_tr+tr>td]:border-t [&_tbody_tr+tr>td]:border-border/40">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
  tr: ({ children }) => <tr className="transition-colors hover:bg-muted/25">{children}</tr>,
  th: ({ children }) => (
    <th className="border-b border-border/60 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-foreground/80">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top leading-relaxed text-foreground/85 text-pretty [&>p]:my-0">{children}</td>
  ),
  img: ({ alt, src }) => (
    <a
      href={typeof src === "string" ? src : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 break-all text-brand underline underline-offset-2 hover:text-brand/80"
    >
      {alt || "image"}
    </a>
  ),
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (isValidElement(child)) {
      const props = child.props as { className?: string; children?: ReactNode };
      const language = /language-([\w+-]+)/u.exec(props.className ?? "")?.[1] ?? "";
      return <ChatCodeBlock code={flattenText(props.children)} language={language} />;
    }
    return <pre>{children}</pre>;
  },
  code: ({ children }) => (
    <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
  ),
};

/**
 * Markdown body for one Copilot message. Memoized: history messages never
 * change content, so they are not re-rendered while a sibling streams.
 */
export const CopilotMarkdown = memo(function CopilotMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-[1.7] text-foreground/90 break-words [&>*+*]:mt-4 [&>h1+*]:mt-2 [&>h2+*]:mt-2 [&>h3+*]:mt-1.5 [&>h4+*]:mt-1.5 [&>h5+*]:mt-1 [&>h6+*]:mt-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={safeUrl}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

/** Fence-language hint -> file extension understood by detectWorkspaceLanguage. */
const FENCE_LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: "ts",
  tsx: "tsx",
  javascript: "js",
  jsx: "jsx",
  node: "js",
  python: "py",
  py: "py",
  bash: "sh",
  shell: "sh",
  sh: "sh",
  zsh: "sh",
  console: "sh",
  json: "json",
  jsonc: "jsonc",
  yaml: "yml",
  yml: "yml",
  rust: "rs",
  golang: "go",
  go: "go",
  kotlin: "kt",
  csharp: "cs",
  ruby: "rb",
  dockerfile: "dockerfile",
  diff: "diff",
};

async function highlightChatCode(code: string, language: string): Promise<ThemedToken[][] | null> {
  const extension = FENCE_LANGUAGE_EXTENSIONS[language.toLowerCase()] ?? language.toLowerCase();
  // Unknown/plain fence languages resolve to no grammar and render plain text.
  const fileName = extension ? `snippet.${extension}` : "snippet.txt";
  return highlightWorkspaceCode(code, fileName);
}

/**
 * Chat-style fenced-code block: header bar with the language hint and a copy
 * button, monospace body that scrolls horizontally, and lazy Shiki token
 * colors once the grammar is available (plain until then — no layout shift).
 * Memoized so completed blocks are never re-highlighted during streaming.
 */
const ChatCodeBlock = memo(function ChatCodeBlock({ code, language }: { code: string; language: string }) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (!language) return;
    void highlightChatCode(code, language).then((result) => {
      if (!cancelled) setTokens(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const onCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard writes can be denied; the user can still select+copy.
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span className="font-mono normal-case tracking-normal text-foreground/80">{language || "code"}</span>
        <button
          type="button"
          onClick={() => void onCopy()}
          aria-label={copied ? "Copied" : "Copy code"}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 normal-case tracking-normal transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-[1.6]">
        <code>
          {tokens
            ? tokens.map((line, lineIndex) => (
                <span key={lineIndex} className="block min-h-[1em]">
                  {line.map((token, tokenIndex) => {
                    const style = tokenFontStyle(token.fontStyle);
                    return (
                      <span
                        key={tokenIndex}
                        style={{
                          color: token.color,
                          fontStyle: style.italic ? "italic" : undefined,
                          fontWeight: style.bold ? 600 : undefined,
                          textDecoration: style.underline ? "underline" : undefined,
                        }}
                      >
                        {token.content}
                      </span>
                    );
                  })}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
});

/**
 * Convenience wrapper used by streaming surfaces: applies the close-open
 * heuristic before rendering. The trailing cursor span stays outside the
 * markdown source on purpose — fighting the parser with inline cursors loses.
 */
export function StreamingCopilotMarkdown({ text }: { text: string }) {
  return <CopilotMarkdown content={closeOpenMarkdown(text)} />;
}
