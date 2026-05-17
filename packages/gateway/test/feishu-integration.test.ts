import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { describe, it } from "node:test";

import { signJwt } from "../src/auth/jwt.js";
import {
  getFeishuCliStatus,
  type FeishuCliCommandRunner
} from "../src/services/integrations/feishu-cli.js";
import { createFeishuIntegrationRoutes } from "../src/routes/integrations-feishu.js";

const secret = "0123456789abcdef0123456789abcdef";

describe("getFeishuCliStatus", () => {
  it("reports lark-cli as unavailable without leaking stderr when discovery fails", async () => {
    const status = await getFeishuCliStatus({
      runner: async () => ({
        exitCode: 127,
        stdout: "",
        stderr: "command not found: lark-cli sk-secret"
      })
    });

    assert.deepEqual(status, {
      available: false,
      authState: "unknown",
      identityMode: "unknown",
      enabled: false,
      error: "Feishu CLI unavailable"
    });
    assert.equal(JSON.stringify(status).includes("sk-secret"), false);
  });

  it("parses version and structured auth status from allowlisted commands", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: FeishuCliCommandRunner = async (command, args) => {
      calls.push({ command, args });
      if (args.includes("--version")) {
        return { exitCode: 0, stdout: "@larksuite/cli 1.2.3\n", stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({ authenticated: true, identityMode: "user" }),
        stderr: ""
      };
    };

    const status = await getFeishuCliStatus({ runner });

    assert.deepEqual(calls, [
      { command: "lark-cli", args: ["--version"] },
      { command: "lark-cli", args: ["auth", "status", "--output", "json"] }
    ]);
    assert.deepEqual(status, {
      available: true,
      version: "@larksuite/cli 1.2.3",
      authState: "authenticated",
      identityMode: "user",
      enabled: false
    });
  });

  it("fails closed when auth status output is not structured JSON", async () => {
    const status = await getFeishuCliStatus({
      runner: async (_command, args) => {
        if (args.includes("--version")) {
          return { exitCode: 0, stdout: "lark-cli 0.9.0\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "logged in as someone@example.com", stderr: "" };
      }
    });

    assert.deepEqual(status, {
      available: true,
      version: "lark-cli 0.9.0",
      authState: "unknown",
      identityMode: "unknown",
      enabled: false
    });
  });

  it("returns unavailable on timeout without leaking stderr", async () => {
    const status = await getFeishuCliStatus({
      runner: async () => ({
        exitCode: 124,
        stdout: "",
        stderr: "Command timed out after 3000ms with token sk-timeout-secret"
      })
    });

    assert.equal(status.available, false);
    assert.equal(status.authState, "unknown");
    assert.equal(status.identityMode, "unknown");
    assert.equal(status.enabled, false);
    assert.equal(JSON.stringify(status).includes("sk-timeout-secret"), false);
  });

  it("fails closed when the command runner throws", async () => {
    const status = await getFeishuCliStatus({
      runner: async () => {
        throw new Error("spawn failed with token sk-runner-secret");
      }
    });

    assert.deepEqual(status, {
      available: false,
      authState: "unknown",
      identityMode: "unknown",
      enabled: false,
      error: "Feishu CLI unavailable"
    });
    assert.equal(JSON.stringify(status).includes("sk-runner-secret"), false);
  });
});

describe("Feishu integration routes", () => {
  it("returns authenticated read-only Feishu integration status", async () => {
    const app = express();
    app.locals.jwtSecret = secret;
    app.use(express.json());
    app.use("/api/v1/integrations/feishu", createFeishuIntegrationRoutes({
      getStatus: async () => ({
        available: true,
        version: "lark-cli 1.2.3",
        authState: "authenticated",
        identityMode: "user",
        enabled: false
      })
    }));

    const token = signJwt({ userId: "user-1", email: "route@example.com" }, secret);
    const res = await makeRequest(app, "GET", "/api/v1/integrations/feishu/status", undefined, {
      Authorization: `Bearer ${token}`
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      code: 0,
      data: {
        status: {
          available: true,
          version: "lark-cli 1.2.3",
          authState: "authenticated",
          identityMode: "user",
          enabled: false
        }
      },
      message: ""
    });
  });
});

async function makeRequest(
  app: express.Express,
  method: string,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: pathname,
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            server.close();
            resolve({
              status: res.statusCode || 0,
              body: data ? JSON.parse(data) : undefined
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
