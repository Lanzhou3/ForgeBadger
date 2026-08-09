import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { configWriteOutcomeResponse } from "../src/routes/projects.js";

describe("config write outcomes", () => {
  it("maps sync write rollback outcomes to failing HTTP envelopes", () => {
    assert.deepEqual(configWriteOutcomeResponse("applied"), {
      status: 200,
      code: 0,
      message: ""
    });
    assert.deepEqual(configWriteOutcomeResponse("rolled_back"), {
      status: 409,
      code: 1,
      message: "Config write rolled_back"
    });
    assert.deepEqual(configWriteOutcomeResponse("rollback_failed"), {
      status: 500,
      code: 1,
      message: "Config write rollback_failed"
    });
  });
});
