import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homedir } from "node:os";
import { createSecurityPolicy, logSecurityDecision } from "../src/services/agent/security-policy.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const home = "/Users/alice";

function setupDb(): Database {
  const db = new Database(":memory:");
  const migDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");
  for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migDir, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) db.exec(t);
    }
  }
  db.prepare("INSERT INTO users (id, username, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run("u1", "u1", "u1@x.co", "hash", "user", "active");
  return db;
}

describe("security policy", () => {
  const policy = createSecurityPolicy({ homeDir: home });

  it("auto-approves read tools", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "list_projects",
      toolRisk: "read",
      requiresApproval: false,
      input: {}
    });
    assert.equal(decision.action, "auto_approve");
    assert.equal(decision.riskClass, "low");
  });

  it("requires approval for generic operate tools", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "delete_everything",
      toolRisk: "operate",
      requiresApproval: true,
      input: {}
    });
    assert.equal(decision.action, "require_approval");
  });

  it("auto-approves create_project under home directory", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: `${home}/Projects/my-app` }
    });
    assert.equal(decision.action, "auto_approve");
    assert.equal(decision.riskClass, "low");
  });

  it("auto-approves create_project with tilde expansion", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "~/Projects/my-app" }
    });
    assert.equal(decision.action, "auto_approve");
  });

  it("requires approval when create_project path is outside home", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "/opt/projects/my-app" }
    });
    assert.equal(decision.action, "require_approval");
    assert.equal(decision.riskClass, "high");
  });

  it("denies create_project under denied roots", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "/etc/my-app" }
    });
    assert.equal(decision.action, "deny");
    assert.equal(decision.riskClass, "high");
  });

  it("denies traversal in create_project path", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: `${home}/Projects/../etc` }
    });
    assert.equal(decision.action, "deny");
  });

  it("requires approval for relative create_project path", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "create_project",
      toolRisk: "operate",
      requiresApproval: true,
      input: { name: "x", path: "Projects/my-app" }
    });
    assert.equal(decision.action, "require_approval");
  });

  it("always requires approval for advance_work_item", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "advance_work_item",
      toolRisk: "operate",
      requiresApproval: true,
      input: { workItemId: "wi-1", toState: "done", idempotencyKey: "k1" }
    });
    assert.equal(decision.action, "require_approval");
    assert.equal(decision.riskClass, "high");
  });

  it("denies inputs containing traversal", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "write_memory",
      toolRisk: "read",
      requiresApproval: false,
      input: { text: "note", scope: "project", projectId: "../etc" }
    });
    assert.equal(decision.action, "deny");
  });

  it("does not mistake serialized multiline Markdown ellipses for Windows traversal", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: {
        sessionId: "sess-1",
        message: "请继续处理...\n\n1. 先复现问题\n2. 再运行测试"
      }
    });

    assert.equal(decision.action, "require_approval");
    assert.equal(decision.reason, "operate tool default approval gate");
  });

  it("denies real POSIX and Windows traversal in nested raw input strings", () => {
    for (const value of ["../../etc/passwd", "C:\\workspace\\..\\secret.txt"]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { payload: { values: ["safe", value] } }
      });

      assert.equal(decision.action, "deny", value);
      assert.equal(decision.reason, "input contains path traversal", value);
    }
  });

  it("continues to deny destructive shell patterns in nested raw input strings", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { payload: [{ message: "rm -rf /tmp/project" }] }
    });

    assert.equal(decision.action, "deny");
    assert.equal(decision.reason, "input contains potentially destructive shell pattern");
  });

  it("denies destructive shell syntax with valid separators and spacing variants", () => {
    for (const message of [
      "dd if=/dev/zero of=/tmp/disk.img",
      ": > /tmp/output.log",
      "rm  -rf /tmp/project",
      "rm\t-rf /tmp/project"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "deny", message);
      assert.equal(decision.reason, "input contains potentially destructive shell pattern", message);
    }
  });

  it("does not deny ordinary Markdown containing similar punctuation", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: "> Note: continue...\n\n- Review the dd documentation\n- Keep rm examples descriptive" }
    });

    assert.equal(decision.action, "require_approval");
  });

  it("denies destructive truncation at LF and CRLF command boundaries", () => {
    for (const message of ["prefix\n: > /tmp/output.log", "prefix\r\n: > /tmp/output.log"]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "deny", JSON.stringify(message));
      assert.equal(decision.reason, "input contains potentially destructive shell pattern");
    }
  });

  it("does not treat an inline Markdown explanation of >: as a shell command", () => {
    const decision = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: "格式说明：符号 >: 表示输出关系，不是需要执行的命令。" }
    });

    assert.equal(decision.action, "require_approval");
  });

  it("denies destructive commands at command-segment starts", () => {
    for (const message of [
      "  rm -r -f /tmp/project",
      "rm -fr /tmp/project",
      "rm --recursive --force /tmp/project",
      "dd of=/tmp/disk.img if=/dev/zero",
      "mkfs /dev/sdb1",
      ": > /tmp/output.log",
      "echo ready && rm -rf /tmp/project",
      "echo ready || dd of=/tmp/disk.img if=/dev/zero",
      "printf ready | mkfs /dev/sdb1"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "deny", message);
      assert.equal(decision.reason, "input contains potentially destructive shell pattern", message);
    }
  });

  it("does not deny command names that only appear in prose or Markdown examples", () => {
    for (const message of [
      "文档里的 rm -rf 示例仅用于解释参数",
      "请解释裸 mkfs 的用途，不要执行命令",
      "代码说明中的 dd of=/tmp/x if=/dev/zero 只是示例",
      "Markdown blockquote:\n> /tmp/output.log"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("does not interpret fenced, table, or indented Markdown code as executable commands", () => {
    for (const message of [
      "示例代码：\n```sh\nrm -rf /tmp/project\n```",
      "| 命令 | 说明 |\n| --- | --- |\n| rm -rf /tmp/project | 仅作示例 |",
      "命令 | 说明\n--- | ---\nrm -rf /tmp/project | 仅作示例",
      "示例：\n    rm -rf /tmp/project",
      "示例：\n\trm -rf /tmp/project"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("denies wrapped commands, postposed rm flags, and strict truncation forms", () => {
    for (const message of [
      "sudo rm -rf /tmp/project",
      "sudo -u root rm -rf /tmp/project",
      "env FORGEBADGER_TEST=1 rm -r -f /tmp/project",
      "rm /tmp/project -fr",
      ":>/tmp/output.log",
      ">/tmp/output.log",
      "echo ready; > /tmp/output.log",
      "echo ready & rm -rf /tmp/project"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "deny", message);
    }
  });

  it("treats spaced line-start redirection as Markdown blockquote, not a shell command", () => {
    for (const message of ["> /tmp/output.log", "> rm -rf /tmp/project"]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("does not treat quoted or inline-code shell text as executable segments", () => {
    for (const message of [
      'echo "literal | rm -rf /tmp/project"',
      "文档示例：`echo safe | rm -rf /tmp/project`，不要执行"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("consumes env options with values before checking the wrapped command", () => {
    for (const message of [
      "env -u OLD_TOKEN rm -rf /tmp/project",
      "env --unset OLD_TOKEN rm -rf /tmp/project",
      "env -C /tmp rm -rf /tmp/project",
      "env --chdir /tmp rm -rf /tmp/project",
      "env --unset=OLD_TOKEN rm -rf /tmp/project",
      "env --chdir=/tmp rm -rf /tmp/project",
      "env -- FORGEBADGER_TEST=1 rm -rf /tmp/project"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });

      assert.equal(decision.action, "deny", message);
    }
  });

  it("denies :> with a separate target without treating bare or prose tokens as commands", () => {
    const dangerous = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: ":> /tmp/output.log" }
    });
    assert.equal(dangerous.action, "deny");

    for (const message of [":>", "文档中的 :> /tmp/output.log 只是示例", "env -u OLD_TOKEN echo rm -rf /tmp/project"]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("expands env split-string options before evaluating the real command", () => {
    for (const message of [
      'env -S "rm -rf /tmp/project"',
      'env --split-string "rm -rf /tmp/project"',
      'env --split-string="rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "deny", message);
    }

    const safe = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: 'env -S "echo rm -rf /tmp/project"' }
    });
    assert.equal(safe.action, "require_approval");
  });

  it("treats GNU env split-string \\_ escapes as token separators", () => {
    for (const message of [
      "env -S 'rm\\_-rf\\_/tmp/project'",
      "env --split-string='rm\\_-rf\\_/tmp/project'",
      'env -S "rm\\_-rf\\_/tmp/project"',
      'env --split-string="rm\\_-rf\\_/tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "deny", message);
    }

    for (const message of [
      "env -S 'echo\\_rm\\_-rf\\_/tmp/project'",
      'env -S "echo\\_rm\\_-rf\\_/tmp/project"'
    ]) {
      const safe = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(safe.action, "require_approval", message);
    }
  });

  it("denies leading assignments and bounded command, nohup, and shell -c wrappers", () => {
    for (const message of [
      "FOO=1 rm -rf /tmp/project",
      "FOO=1 command rm -rf /tmp/project",
      "command rm -rf /tmp/project",
      "nohup rm -rf /tmp/project",
      'sh -c "rm -rf /tmp/project"',
      'bash -c "rm -rf /tmp/project"',
      'zsh -c "rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "deny", message);
    }
  });

  it("recognizes shell append assignments before the real command", () => {
    const dangerous = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: "FOO+=1 rm -rf /tmp/project" }
    });
    assert.equal(dangerous.action, "deny");

    const safe = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: "FOO+=1 echo rm -rf /tmp/project" }
    });
    assert.equal(safe.action, "require_approval");
  });

  it("consumes command -p and -- before the real command", () => {
    const dangerous = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: "command -p -- rm -rf /tmp/project" }
    });
    assert.equal(dangerous.action, "deny");

    const safe = policy.evaluate({
      userId: "u1",
      toolName: "dispatch_task_to_session",
      toolRisk: "operate",
      requiresApproval: true,
      input: { message: "command -p -- echo rm -rf /tmp/project" }
    });
    assert.equal(safe.action, "require_approval");
  });

  it("treats shell -c payloads as executable scripts instead of Markdown", () => {
    for (const message of [
      'bash -c "    rm -rf /tmp/project"',
      'bash -c "\trm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "deny", message);
    }

    for (const message of [
      'bash -c "    echo rm -rf /tmp/project"',
      'bash -c "\techo rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("consumes bounded shell options with values before locating -c", () => {
    for (const message of [
      'bash -o pipefail -c "rm -rf /tmp/project"',
      'bash -O extglob -c "rm -rf /tmp/project"',
      'zsh -o SH_WORD_SPLIT -c "rm -rf /tmp/project"',
      'bash -o=pipefail -c "rm -rf /tmp/project"',
      'bash -O=extglob -c "rm -rf /tmp/project"',
      'bash -Oextglob -c "rm -rf /tmp/project"',
      'bash -euo pipefail -c "rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "deny", message);
    }

    for (const message of [
      'bash -o pipefail -c "echo rm -rf /tmp/project"',
      'bash -O extglob -c "echo rm -rf /tmp/project"',
      'zsh -o SH_WORD_SPLIT -c "echo rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("preserves -c across combined and long shell options with values", () => {
    for (const message of [
      'bash -oc pipefail "rm -rf /tmp/project"',
      'bash -Oc extglob "rm -rf /tmp/project"',
      'bash -Oec extglob "rm -rf /tmp/project"',
      'bash --rcfile /tmp/bashrc -c "rm -rf /tmp/project"',
      'bash --init-file /tmp/bashrc -c "rm -rf /tmp/project"',
      'bash --rcfile=/tmp/bashrc -c "rm -rf /tmp/project"',
      'bash --init-file=/tmp/bashrc -c "rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "deny", message);
    }

    for (const message of [
      'bash -oc pipefail "echo rm -rf /tmp/project"',
      'bash -Oc extglob "echo rm -rf /tmp/project"',
      'bash -Oec extglob "echo rm -rf /tmp/project"',
      'bash --rcfile /tmp/bashrc -c "echo rm -rf /tmp/project"',
      'bash --init-file=/tmp/bashrc -c "echo rm -rf /tmp/project"',
      'bash --unsupported-option -c "rm -rf /tmp/project"',
      'bash -Z -c "rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("consumes whitelisted +o and +O option values before locating -c", () => {
    for (const message of [
      'bash +O extglob -c "rm -rf /tmp/project"',
      'bash +o pipefail -c "rm -rf /tmp/project"',
      'zsh +o SH_WORD_SPLIT -c "rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "deny", message);
    }

    for (const message of [
      'bash +O extglob -c "echo rm -rf /tmp/project"',
      'bash +o pipefail -c "echo rm -rf /tmp/project"',
      'zsh +o SH_WORD_SPLIT -c "echo rm -rf /tmp/project"',
      'bash +Z -c "rm -rf /tmp/project"'
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "require_approval", message);
    }
  });

  it("does not deny safe wrapper commands or prose and Markdown examples", () => {
    for (const message of [
      "FOO=1 echo rm -rf /tmp/project",
      "command echo rm -rf /tmp/project",
      "nohup echo rm -rf /tmp/project",
      'bash -c "echo rm -rf /tmp/project"',
      "文档说明 bash -c `rm -rf /tmp/project`，不要执行",
      "```sh\nFOO=1 rm -rf /tmp/project\n```"
    ]) {
      const decision = policy.evaluate({
        userId: "u1",
        toolName: "dispatch_task_to_session",
        toolRisk: "operate",
        requiresApproval: true,
        input: { message }
      });
      assert.equal(decision.action, "require_approval", message);
    }
  });
});

describe("security policy audit log", () => {
  it("writes a copilot_operation_log row", () => {
    const db = setupDb();
    logSecurityDecision({
      db,
      userId: "u1",
      operation: "create_project",
      input: { path: "~/x" },
      action: "auto_approve",
      reason: "within home"
    });
    const rows = db.prepare("SELECT * FROM copilot_operation_log WHERE user_id = ?").all("u1") as unknown[];
    assert.equal(rows.length, 1);
  });

  it("tolerates duplicate decisions with identical input instead of rejecting the operation", () => {
    const db = setupDb();
    const decision = {
      db,
      userId: "u1",
      operation: "list_projects",
      input: {},
      action: "auto_approve" as const,
      reason: "read-only"
    };
    logSecurityDecision(decision);
    // A repeated identical tool call (e.g. the model listing projects in two
    // conversations) must not crash the run with a UNIQUE constraint error.
    logSecurityDecision(decision);
    const rows = db.prepare("SELECT * FROM copilot_operation_log WHERE user_id = ?").all("u1") as unknown[];
    assert.equal(rows.length, 1);
  });
});
