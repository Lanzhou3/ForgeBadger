import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCliArgs } from "../src/index.js";

describe("parseCliArgs", () => {
  it("defaults to start when no command is provided", () => {
    assert.deepEqual(parseCliArgs([]), {
      command: "start",
      gatewayPort: undefined,
      webPort: undefined,
      host: undefined,
      openBrowser: false
    });
  });

  it("parses start ports and host", () => {
    assert.deepEqual(parseCliArgs(["start", "--gateway-port", "48731", "--web-port", "48732", "--host", "127.0.0.1"]), {
      command: "start",
      gatewayPort: 48731,
      webPort: 48732,
      host: "127.0.0.1",
      openBrowser: false
    });
  });

  it("parses open browser flag", () => {
    assert.deepEqual(parseCliArgs(["start", "--open"]), {
      command: "start",
      gatewayPort: undefined,
      webPort: undefined,
      host: undefined,
      openBrowser: true
    });
  });

  it("defaults to start when open flag is provided without a command", () => {
    assert.deepEqual(parseCliArgs(["--open"]), {
      command: "start",
      gatewayPort: undefined,
      webPort: undefined,
      host: undefined,
      openBrowser: true
    });
  });

  it("defaults to start when start options are provided without a command", () => {
    assert.deepEqual(parseCliArgs(["--gateway-port", "3001"]), {
      command: "start",
      gatewayPort: 3001,
      webPort: undefined,
      host: undefined,
      openBrowser: false
    });

    assert.deepEqual(parseCliArgs(["--web-port", "3002"]), {
      command: "start",
      gatewayPort: undefined,
      webPort: 3002,
      host: undefined,
      openBrowser: false
    });

    assert.deepEqual(parseCliArgs(["--host", "127.0.0.1"]), {
      command: "start",
      gatewayPort: undefined,
      webPort: undefined,
      host: "127.0.0.1",
      openBrowser: false
    });
  });

  it("rejects unknown commands", () => {
    assert.throws(() => parseCliArgs(["launch"]), /Unknown command: launch/);
  });

  it("rejects invalid ports", () => {
    assert.throws(() => parseCliArgs(["start", "--gateway-port", "70000"]), /Invalid --gateway-port: 70000/);
  });

  it("rejects missing flag values", () => {
    assert.throws(() => parseCliArgs(["start", "--host"]), /Missing value for --host/);
    assert.throws(() => parseCliArgs(["start", "--host", "--open"]), /Missing value for --host/);
  });

  it("parses doctor command", () => {
    assert.deepEqual(parseCliArgs(["doctor"]), {
      command: "doctor"
    });
  });

  it("parses config command arguments", () => {
    assert.deepEqual(parseCliArgs(["config", "show"]), {
      command: "config",
      args: ["show"]
    });
  });

  it("parses help aliases", () => {
    assert.deepEqual(parseCliArgs(["help"]), {
      command: "help"
    });
    assert.deepEqual(parseCliArgs(["--help"]), {
      command: "help"
    });
    assert.deepEqual(parseCliArgs(["-h"]), {
      command: "help"
    });
  });

  it("preserves init arguments for the existing init flow", () => {
    assert.deepEqual(parseCliArgs(["init", "--path", "/tmp/project", "--dry-run"]), {
      command: "init",
      args: ["init", "--path", "/tmp/project", "--dry-run"]
    });
  });
});
