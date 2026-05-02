import { describe, expect, it } from "vitest";

import {
  formValueToText,
  readAiConfigFieldValue,
  textToFormValue,
  updateAiConfigDraft,
} from "./ai-config-forms";
import type { AiConfigFormField } from "./api";

const listField: AiConfigFormField = {
  key: "permissions.allow",
  label: "Allowed Tools",
  inputType: "list",
  path: "permissions.allow",
};

describe("ai config form helpers", () => {
  it("updates nested JSON config fields and serializes list values", () => {
    const result = updateAiConfigDraft(
      "{\n  \"permissions\": { \"allow\": [\"Read\"] }\n}\n",
      "json",
      listField,
      ["Read", "Bash(git status:*)"]
    );

    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({
      permissions: {
        allow: ["Read", "Bash(git status:*)"],
      },
    });
    expect(readAiConfigFieldValue(result.content, "json", listField)).toEqual([
      "Read",
      "Bash(git status:*)",
    ]);
  });

  it("updates Codex TOML fields in existing sections and appends missing top-level keys", () => {
    const webSearchField: AiConfigFormField = {
      key: "features.web_search_request",
      label: "Web Search",
      inputType: "boolean",
      path: "features.web_search_request",
    };
    const sandboxField: AiConfigFormField = {
      key: "sandbox_mode",
      label: "Sandbox Mode",
      inputType: "select",
      path: "sandbox_mode",
      options: ["read-only", "workspace-write"],
    };

    const withFeature = updateAiConfigDraft(
      "model = \"gpt-5\"\n[features]\nweb_search_request = false\n",
      "toml",
      webSearchField,
      true
    );
    const withSandbox = updateAiConfigDraft(withFeature.content, "toml", sandboxField, "workspace-write");

    expect(withSandbox.error).toBeUndefined();
    expect(withSandbox.content).toContain("web_search_request = true");
    expect(withSandbox.content).toContain("sandbox_mode = \"workspace-write\"");
    expect(readAiConfigFieldValue(withSandbox.content, "toml", webSearchField)).toBe(true);
    expect(readAiConfigFieldValue(withSandbox.content, "toml", sandboxField)).toBe("workspace-write");
  });

  it("maps textarea content and list text values for form controls", () => {
    const contentField: AiConfigFormField = {
      key: "content",
      label: "Instructions",
      inputType: "textarea",
      path: "$content",
    };

    expect(readAiConfigFieldValue("# Instructions\n", "markdown", contentField)).toBe("# Instructions\n");
    expect(updateAiConfigDraft("# Old\n", "markdown", contentField, "# New\n").content).toBe("# New\n");
    expect(formValueToText(["Read", "Write"])).toBe("Read\nWrite");
    expect(textToFormValue("Read\n\nWrite\n", listField)).toEqual(["Read", "Write"]);
  });
});
