import type { BundledLanguage, Highlighter, ThemedToken } from "shiki";

/**
 * Lazy singleton Shiki highlighter for the workspace file viewer.
 *
 * The app is dark-only (`<html className="dark">`), so a single dark theme is
 * enough. Languages are loaded on demand from the bundled lazy grammars to
 * keep the initial bundle small.
 */

const THEME = "github-dark-default";

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // Dynamic import keeps shiki's engine (grammars + theme) out of the static
    // module graph; it is fetched on first actual highlight request.
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({ themes: [THEME], langs: [] })
    );
  }
  return highlighterPromise;
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  md: "markdown",
  mdx: "mdx",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  sql: "sql",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  tf: "hcl",
  graphql: "graphql",
  gql: "graphql",
  prisma: "prisma",
  proto: "proto",
  r: "r",
  jl: "julia",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  clj: "clojure",
  vim: "vim",
  diff: "diff",
  patch: "diff",
  tex: "latex",
  dockerfile: "dockerfile",
  env: "dotenv",
};

const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: "dockerfile",
  "dockerfile.dev": "dockerfile",
  makefile: "makefile",
  "gnumakefile": "makefile",
  ".env": "dotenv",
  ".env.example": "dotenv",
  ".env.sample": "dotenv",
  ".env.template": "dotenv",
};

/** Resolve a workspace file name to a Shiki language id, or null for plain text. */
export function detectWorkspaceLanguage(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const baseName = lower.split("/").pop() ?? lower;
  const byName = FILENAME_LANGUAGES[baseName];
  if (byName) return byName;
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex <= 0) return null;
  const extension = baseName.slice(dotIndex + 1);
  return EXTENSION_LANGUAGES[extension] ?? null;
}

/**
 * Tokenize file content for rendering. Returns null when the file type has no
 * grammar (caller renders plain text). Never throws for unknown languages.
 */
export async function highlightWorkspaceCode(
  content: string,
  fileName: string
): Promise<ThemedToken[][] | null> {
  const lang = detectWorkspaceLanguage(fileName);
  if (!lang) return null;
  try {
    const highlighter = await getHighlighter();
    const bundledLang = lang as BundledLanguage;
    if (!loadedLanguages.has(lang)) {
      await highlighter.loadLanguage(bundledLang);
      loadedLanguages.add(lang);
    }
    const { tokens } = highlighter.codeToTokens(content, { lang: bundledLang, theme: THEME });
    return tokens;
  } catch {
    // Grammar load or parse failure must never break file viewing.
    return null;
  }
}

/** Shiki FontStyle bitmask: 1 = italic, 2 = bold, 4 = underline. */
export function tokenFontStyle(fontStyle: number | undefined): {
  italic: boolean;
  bold: boolean;
  underline: boolean;
} {
  const value = fontStyle ?? 0;
  return {
    italic: (value & 1) !== 0,
    bold: (value & 2) !== 0,
    underline: (value & 4) !== 0,
  };
}
