import { describe, expect, it } from "vitest";

import { highlightCode, supportsSyntaxHighlighting } from "./syntax-highlight";

describe("syntax highlight helpers", () => {
  it("highlights JSON keys, strings, booleans, nulls, and numbers for the editor layer", () => {
    const parts = highlightCode('{"model":"claude","enabled":true,"limit":3,"fallback":null}', "json");

    expect(parts).toEqual(
      expect.arrayContaining([
        { text: '"model"', className: "text-sky-300" },
        { text: '"claude"', className: "text-emerald-300" },
        { text: "true", className: "text-purple-300" },
        { text: "3", className: "text-amber-300" },
        { text: "null", className: "text-purple-300" },
      ])
    );
  });

  it("keeps unsupported file types editable without a highlighted preview mode", () => {
    expect(supportsSyntaxHighlighting("text")).toBe(false);
    expect(highlightCode("plain text", "text")).toEqual([{ text: "plain text" }]);
  });
});
