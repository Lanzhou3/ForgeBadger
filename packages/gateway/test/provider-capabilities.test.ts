import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getProviderCapabilities } from "../src/services/provider-capabilities.js";

describe("provider capability matrix", () => {
  it("exposes per-adapter api formats and model selection modes", () => {
    const codex = getProviderCapabilities().find((entry) => entry.adapter === "codex");
    assert.deepEqual(codex?.authModes, ["native_cli_login", "managed_credential"]);
    assert.deepEqual(codex?.apiFormats, ["openai", "openai-compatible"]);
    assert.equal(codex?.projectionScope, "user-global");
    const kimi = getProviderCapabilities().find((entry) => entry.adapter === "kimi");
    assert.equal(kimi?.modelSelection, "native-config");
    assert.equal(kimi?.remoteModelList, false);
    assert.ok(getProviderCapabilities().every((entry) => !("bindingProjection" in entry)));
    assert.ok(getProviderCapabilities().every((entry) => !("bindingImport" in entry)));
  });
});
