import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactSensitiveErrorMessage } from "../src/lib/redaction.js";
import { redactText } from "../src/services/redaction.js";

const legacySecrets = [
  "OPENFORGE_MASTER_KEY=legacy-master",
  "OPENFORGE_JWT_SECRET=legacy-jwt",
  "OPENFORGE_ATTACH_TOKEN=legacy-attach"
].join(" ");

describe("legacy OpenForge secret redaction", () => {
  it("redacts legacy secret env assignments from shared audit text", () => {
    const redacted = redactText(legacySecrets);

    assert.doesNotMatch(redacted, /legacy-master|legacy-jwt|legacy-attach/u);
  });

  it("redacts legacy secret env assignments from public error messages", () => {
    const redacted = redactSensitiveErrorMessage(legacySecrets);

    assert.doesNotMatch(redacted, /legacy-master|legacy-jwt|legacy-attach/u);
  });
});
