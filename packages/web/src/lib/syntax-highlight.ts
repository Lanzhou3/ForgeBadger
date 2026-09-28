export interface HighlightedCodePart {
  text: string;
  className?: string;
}

const highlightedFileTypes = new Set(["json", "toml", "yaml", "markdown", "javascript"]);

export function supportsSyntaxHighlighting(fileType: string): boolean {
  return highlightedFileTypes.has(fileType);
}

export function highlightCode(content: string, fileType: string): HighlightedCodePart[] {
  if (fileType === "json") {
    return highlightWithPattern(
      content,
      /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/gu,
      (match) => {
        if (match[1]) return "text-sky-300";
        if (match[2]) return "text-emerald-300";
        if (match[3]) return "text-purple-300";
        return "text-amber-300";
      }
    );
  }
  if (fileType === "toml" || fileType === "yaml") {
    return highlightWithPattern(
      content,
      /(^\s*[A-Za-z0-9_.-]+(?=\s*[:=]))|("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b)|(-?\d+(?:\.\d+)?)/gmu,
      (match) => {
        if (match[1]) return "text-sky-300";
        if (match[2]) return "text-emerald-300";
        if (match[3]) return "text-purple-300";
        return "text-amber-300";
      }
    );
  }
  if (fileType === "markdown") {
    return highlightWithPattern(content, /(^#{1,6}\s.*$)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/gmu, (match) => {
      if (match[1]) return "text-sky-300";
      if (match[2]) return "text-amber-300";
      return "text-emerald-300";
    });
  }
  if (fileType === "javascript") {
    return highlightWithPattern(
      content,
      /\b(const|let|var|function|return|if|else|import|export|from|await|async)\b|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gu,
      (match) => match[1] ? "text-purple-300" : "text-emerald-300"
    );
  }
  return [{ text: content }];
}

function highlightWithPattern(
  content: string,
  pattern: RegExp,
  classForMatch: (match: RegExpExecArray) => string
): HighlightedCodePart[] {
  const parts: HighlightedCodePart[] = [];
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ text: content.slice(cursor, index) });
    }
    parts.push({ text: match[0], className: classForMatch(match) });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) {
    parts.push({ text: content.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ text: content }];
}
