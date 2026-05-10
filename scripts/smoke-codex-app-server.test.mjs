import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCodexAppServerInitializeRequest,
  buildCodexAppServerInitializedNotification,
  buildCodexAppServerSmokeResult,
  buildCodexAppServerSmokeRoot,
  buildCodexAppServerSmokeToken,
  sanitizeCodexAppServerEnv
} from "./smoke-codex-app-server.mjs";

describe("Codex app-server smoke harness", () => {
  it("builds initialize-only protocol frames", () => {
    assert.deepEqual(buildCodexAppServerInitializeRequest(7), {
      id: 7,
      method: "initialize",
      params: {
        clientInfo: {
          name: "openforge",
          title: "OpenForge",
          version: "0.0.0"
        },
        capabilities: {
          experimentalApi: false,
          optOutNotificationMethods: []
        }
      }
    });
    assert.deepEqual(buildCodexAppServerInitializedNotification(), { method: "initialized" });
  });

  it("builds isolated filesystem and token inputs", () => {
    const root = buildCodexAppServerSmokeRoot("/tmp/openforge-codex-smoke-test");
    const token = buildCodexAppServerSmokeToken(Buffer.from("012345678901234567890123"));

    assert.equal(root.home, "/tmp/openforge-codex-smoke-test/home");
    assert.equal(root.codexHome, "/tmp/openforge-codex-smoke-test/codex-home");
    assert.equal(root.project, "/tmp/openforge-codex-smoke-test/project");
    assert.equal(root.tokenFile, "/tmp/openforge-codex-smoke-test/capability.token");
    assert.equal(token, "of_MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIz");
  });

  it("sanitizes inherited environment and redacts smoke output", () => {
    const env = sanitizeCodexAppServerEnv({
      PATH: "/usr/bin",
      HOME: "/root",
      CODEX_HOME: "/root/.codex",
      OPENAI_API_KEY: "secret",
      DATABASE_URL: "postgres://secret",
      LANG: "C.UTF-8"
    }, {
      home: "/tmp/home",
      codexHome: "/tmp/codex-home"
    });

    assert.deepEqual(env, {
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      CODEX_HOME: "/tmp/codex-home",
      LANG: "C.UTF-8"
    });

    assert.deepEqual(
      buildCodexAppServerSmokeResult({
        mode: "app-server-websocket",
        root: "/tmp/openforge-codex-smoke-test",
        codexHome: "/tmp/openforge-codex-smoke-test/codex-home",
        project: "/tmp/openforge-codex-smoke-test/project",
        listen: "ws://127.0.0.1:45678",
        userAgent: "openforge/0.130.0",
        platformFamily: "unix",
        platformOs: "linux",
        extraMessages: [{ method: "remoteControl/status/changed", params: { status: "disabled" } }]
      }),
      {
        ok: true,
        mode: "app-server-websocket",
        root: "/tmp/openforge-codex-smoke-test",
        codexHome: "/tmp/openforge-codex-smoke-test/codex-home",
        project: "/tmp/openforge-codex-smoke-test/project",
        listen: "ws://127.0.0.1:45678",
        userAgent: "openforge/0.130.0",
        platformFamily: "unix",
        platformOs: "linux",
        promptOrTurnSent: false,
        extraMessageMethods: ["remoteControl/status/changed"]
      }
    );
  });
});
