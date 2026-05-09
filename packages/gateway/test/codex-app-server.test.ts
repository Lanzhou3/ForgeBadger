import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCodexAppServerInitializeRequest,
  createCodexAppServerLaunchPlan,
  createCodexThreadStartRequest,
  createCodexTurnStartRequest
} from "../src/services/codex-app-server.js";

describe("Codex app-server helpers", () => {
  it("creates a stdio app-server launch plan without a shell wrapper", () => {
    const plan = createCodexAppServerLaunchPlan({
      projectRoot: "/workspace/app",
      credentialMode: "host_environment",
      env: { OPENFORGE_SESSION_ID: "session-1" }
    });

    assert.equal(plan.command, "codex");
    assert.deepEqual(plan.args, ["app-server", "--listen", "stdio://"]);
    assert.equal(plan.cwd, "/workspace/app");
    assert.equal("shell" in plan, false);
    assert.equal(plan.env.OPENFORGE_SESSION_ID, "session-1");
  });

  it("creates a loopback websocket app-server launch plan with token-file auth", () => {
    const plan = createCodexAppServerLaunchPlan({
      projectRoot: "/workspace/app",
      credentialMode: "stored_encrypted_key",
      listen: "ws://127.0.0.1:4500",
      wsAuth: {
        mode: "capability-token",
        tokenFile: "/tmp/openforge-codex-token"
      },
      env: { OPENAI_API_KEY: "secret" },
      secretEnvNames: ["OPENAI_API_KEY"]
    });

    assert.deepEqual(plan.args, [
      "app-server",
      "--listen",
      "ws://127.0.0.1:4500",
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      "/tmp/openforge-codex-token"
    ]);
    assert.deepEqual(plan.secretEnvNames, ["OPENAI_API_KEY"]);
  });

  it("builds initialize, thread/start, and turn/start Codex app-server requests", () => {
    assert.deepEqual(
      createCodexAppServerInitializeRequest({
        id: 0,
        clientVersion: "0.0.0",
        experimentalApi: true,
        optOutNotificationMethods: ["item/agentMessage/delta"]
      }),
      {
        method: "initialize",
        id: 0,
        params: {
          clientInfo: {
            name: "openforge",
            title: "OpenForge",
            version: "0.0.0"
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: ["item/agentMessage/delta"]
          }
        }
      }
    );

    assert.deepEqual(
      createCodexThreadStartRequest({
        id: 1,
        cwd: "/workspace/app",
        model: "gpt-5.4",
        approvalPolicy: "on-request",
        sandbox: "workspace-write"
      }),
      {
        method: "thread/start",
        id: 1,
        params: {
          cwd: "/workspace/app",
          model: "gpt-5.4",
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          serviceName: "openforge"
        }
      }
    );

    assert.deepEqual(
      createCodexTurnStartRequest({
        id: 2,
        threadId: "thr_123",
        text: "Summarize this repo."
      }),
      {
        method: "turn/start",
        id: 2,
        params: {
          threadId: "thr_123",
          input: [{ type: "text", text: "Summarize this repo.", text_elements: [] }]
        }
      }
    );
  });
});
