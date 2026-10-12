import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAllowedLocalWebOrigin } from "../src/server.js";

describe("isAllowedLocalWebOrigin", () => {
  it("allows localhost and 127.0.0.1 origins on forwarded development ports", () => {
    assert.equal(isAllowedLocalWebOrigin("http://localhost:18333"), true);
    assert.equal(isAllowedLocalWebOrigin("http://127.0.0.1:18333"), true);
  });

  it("rejects non-loopback origins", () => {
    assert.equal(isAllowedLocalWebOrigin("http://example.com:18333"), false);
    assert.equal(isAllowedLocalWebOrigin("not a url"), false);
  });
});
