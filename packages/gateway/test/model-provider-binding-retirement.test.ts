import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gatewayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("retired model provider bindings", () => {
  it("keeps binding records and launch snapshots out of live repository and terminal authorization paths", async () => {
    const relativePaths = [
      "src/db/repositories/model-provider-repository.ts",
      "src/db/repositories/session-repository.ts",
      "src/services/runtime-authorization-invalidation.ts",
      "src/websocket/terminal-runtime-authorization.ts",
      "src/websocket/terminal.ts"
    ];
    const liveSources = await Promise.all(
      relativePaths.map((relativePath) => readFile(path.join(gatewayRoot, relativePath), "utf8"))
    );
    const combined = liveSources.join("\n");

    assert.doesNotMatch(combined, /model_provider_bindings/u);
    assert.doesNotMatch(combined, /launchSnapshot|SessionLaunchSnapshot/u);
    assert.doesNotMatch(combined, /bindingId/u);
    assert.doesNotMatch(combined, /scope:\s*["']binding["']/u);
    assert.doesNotMatch(liveSources[0] ?? "", /FROM\s+sessions\b/iu);
  });
});
