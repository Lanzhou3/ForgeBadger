import { expect, test, type Page, type Route } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openforge-language", "en");
    window.localStorage.setItem("openforge.token", "e2e-token");
    window.localStorage.setItem("openforge.user", JSON.stringify({
      id: "user-e2e",
      email: "copilot-e2e@example.com",
      role: "admin",
      status: "active",
    }));
  });
});

test("Copilot chat blocks sending when no provider is configured", async ({ page }) => {
  await mockCopilotApis(page, { providerConfigured: false });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Summarize release state");

  await expect(page.getByText("Configure a Copilot-compatible model provider first.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Configure provider" })).toHaveAttribute("href", "/models");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("Copilot chat blocks sending when capabilities cannot load", async ({ page }) => {
  await mockCopilotApis(page, { capabilitiesStatus: 500 });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Summarize release state");

  await expect(page.getByText("Failed to load Copilot capabilities").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("Copilot chat creates a conversation and sends messages", async ({ page }) => {
  let createConversationBody: Record<string, unknown> | undefined;
  let sendBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    onCreateConversation: async (route) => {
      createConversationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          conversation: {
            id: "conversation-1",
            title: "Summarize Gateway health",
            source: "copilot",
            status: "active",
            createdAt: 1778490000000,
            updatedAt: 1778490000000,
            lastMessageAt: 1778490000000,
          },
        }),
      });
    },
    onSendMessage: async (route) => {
      sendBody = route.request().postDataJSON() as Record<string, unknown>;
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Summarize Gateway health",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "Gateway is healthy.",
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "completed",
            goal: "Summarize Gateway health",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Summarize Gateway health");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Summarize Gateway health").last()).toBeVisible();
  await expect(page.getByText("Copilot is working...")).toBeVisible();
  await expect.poll(() => createConversationBody).toMatchObject({
    title: "Summarize Gateway health",
    source: "copilot",
  });
  await expect.poll(() => sendBody).toMatchObject({
    prompt: "Summarize Gateway health",
    source: "copilot",
  });
  await expect(page.getByText("Gateway is healthy.")).toBeVisible();
});

test("Copilot chat sends the prompt with Enter", async ({ page }) => {
  let sendBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      sendBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Open the latest session",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "Opening the latest session.",
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "completed",
            goal: "Open the latest session",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Open the latest session");
  await page.keyboard.press("Enter");

  await expect.poll(() => sendBody).toMatchObject({
    prompt: "Open the latest session",
    source: "copilot",
  });
  await expect(page.getByText("Opening the latest session.")).toBeVisible();
});

test("Copilot chat keeps Shift+Enter as a prompt newline", async ({ page }) => {
  let sendBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      sendBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Check active sessions\nthen summarize",
              createdAt: 1778490000000,
            },
          ],
          run: {
            id: "run-1",
            status: "completed",
            goal: "Check active sessions",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  const prompt = page.getByPlaceholder(/Ask Copilot/);
  await prompt.fill("Check active sessions");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Shift");
  await prompt.pressSequentially("then summarize");

  await expect(prompt).toHaveValue("Check active sessions\nthen summarize");
  expect(sendBody).toBeUndefined();

  await page.keyboard.press("Enter");
  await expect.poll(() => sendBody).toMatchObject({
    prompt: "Check active sessions\nthen summarize",
    source: "copilot",
  });
});

test("Copilot new conversation button opens a blank draft instead of reselecting history", async ({ page }) => {
  await mockCopilotApis(page, {
    initialConversations: [{
      id: "conversation-1",
      title: "Existing conversation",
      source: "copilot",
      status: "active",
    }],
    initialMessages: [{
      id: "message-assistant",
      conversationId: "conversation-1",
      role: "assistant",
      content: "Existing answer",
    }],
  });

  await page.goto("/copilot");
  await expect(page.getByText("Existing answer")).toBeVisible();
  await page.getByRole("button", { name: "New conversation" }).click();

  await expect(page.getByText("Start with a question")).toBeVisible();
  await expect(page.getByText("Existing answer")).toHaveCount(0);
});

test("Copilot clears an unsent draft when selecting another conversation", async ({ page }) => {
  await mockCopilotApis(page, {
    initialConversations: [{
      id: "conversation-1",
      title: "Existing conversation",
      source: "copilot",
      status: "active",
    }],
    initialMessages: [{
      id: "message-assistant",
      conversationId: "conversation-1",
      role: "assistant",
      content: "Existing answer",
    }],
  });

  await page.goto("/copilot");
  const prompt = page.getByPlaceholder(/Ask Copilot/);
  await page.getByRole("button", { name: "New conversation" }).click();
  await prompt.fill("This draft belongs to the new conversation");
  await page.getByRole("button", { name: "Existing conversation" }).click();

  await expect(prompt).toHaveValue("");
  await expect(page.getByText("Existing answer")).toBeVisible();
});

test("Copilot does not duplicate the acknowledged user message while an async run is live", async ({ page }) => {
  await mockCopilotApis(page, {
    initialConversations: [{
      id: "conversation-1",
      title: "Existing conversation",
      source: "copilot",
      status: "active",
    }],
    initialMessages: [],
    onSendMessage: async (route) => {
      await route.fulfill({
        status: 202,
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Check project state",
              createdAt: 1778490000000,
            },
          ],
          run: {
            id: "run-1",
            status: "running",
            goal: "Check project state",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
    onGetRun: async (route) => {
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-1",
            status: "running",
            goal: "Check project state",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Check project state");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("article").filter({ hasText: "Check project state" })).toHaveCount(1);
});

test("Copilot deletes a conversation and returns to an empty draft", async ({ page }) => {
  await mockCopilotApis(page, {
    initialConversations: [{
      id: "conversation-1",
      title: "Conversation to delete",
      source: "copilot",
      status: "active",
    }],
    initialMessages: [{
      id: "message-assistant",
      conversationId: "conversation-1",
      role: "assistant",
      content: "Existing answer",
    }],
  });

  await page.goto("/copilot");
  await expect(page.getByText("Existing answer")).toBeVisible();

  await page.getByRole("button", { name: "Delete conversation" }).click();

  await expect(page.getByText("No conversations yet")).toBeVisible();
  await expect(page.getByText("Start with a question")).toBeVisible();
  await expect(page.getByText("Existing answer")).toHaveCount(0);
});

test("Copilot deletes an individual message from the current conversation", async ({ page }) => {
  await mockCopilotApis(page, {
    initialConversations: [{
      id: "conversation-1",
      title: "Conversation with deletable message",
      source: "copilot",
      status: "active",
    }],
    initialMessages: [{
      id: "message-user",
      conversationId: "conversation-1",
      role: "user",
      content: "Remove this message",
    }, {
      id: "message-assistant",
      conversationId: "conversation-1",
      role: "assistant",
      content: "This answer should remain visible.",
    }],
  });

  await page.goto("/copilot");
  await expect(page.getByText("Remove this message")).toBeVisible();
  await expect(page.getByText("This answer should remain visible.")).toBeVisible();

  await page.getByRole("button", { name: "Delete message" }).first().click();

  await expect(page.getByText("Remove this message")).toHaveCount(0);
  await expect(page.getByText("This answer should remain visible.")).toBeVisible();
});

test("Copilot renders assistant Markdown as rich chat content", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "List projects",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: [
                "**Current projects**",
                "",
                "## Next steps",
                "1. Open the active session",
                "2. Capture terminal output",
                "",
                "> Use approvals before sending terminal input.",
                "",
                "- [x] Project catalog loaded",
                "- [ ] Session snapshot captured",
                "",
                "| Project | Status |",
                "| --- | --- |",
                "| aether-glass | active |",
              ].join("\n"),
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "completed",
            goal: "List projects",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("List projects");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next steps" })).toBeVisible();
  await expect(page.getByRole("list").filter({ hasText: "Open the active session" })).toBeVisible();
  await expect(page.getByText("Use approvals before sending terminal input.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Project catalog loaded" })).toBeChecked();
  await expect(page.getByRole("cell", { name: "aether-glass" })).toBeVisible();
});

test("Copilot renders multiple assistant bubbles from one run", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Diagnose project state",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant-plan",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "I will inspect the project list first.",
              createdAt: 1778490000001,
            },
            {
              id: "message-assistant-result",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "No active sessions are currently attached.",
              createdAt: 1778490000002,
            },
          ],
          run: {
            id: "run-1",
            status: "completed",
            goal: "Diagnose project state",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Diagnose project state");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("I will inspect the project list first.")).toBeVisible();
  await expect(page.getByText("No active sessions are currently attached.")).toBeVisible();
});

test("Copilot renders tool events and pending approvals in the chat flow", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Create a Claude Code session",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "Checking whether an existing session is available.",
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "waiting_for_approval",
            goal: "Create a Claude Code session",
            source: "copilot",
          },
          events: [
            {
              id: "event-tool-call",
              runId: "run-1",
              type: "tool_call_requested",
              sequence: 1,
              message: "openforge.propose_session_create",
            },
            {
              id: "event-tool-result",
              runId: "run-1",
              type: "tool_result",
              sequence: 2,
              message: "openforge.propose_session_create",
              payload: {
                output: {
                  actionId: "action-1",
                  type: "openforge.propose_session_create",
                  status: "pending",
                },
              },
            },
          ],
          pendingActions: [
            {
              id: "action-1",
              runId: "run-1",
              type: "openforge.propose_session_create",
              status: "pending",
              input: {
                projectId: "project-1",
                aiTool: "claude",
                name: "Claude Code",
              },
            },
          ],
        }),
      });
    },
    onGetRun: async (route) => {
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-1",
            status: "waiting_for_approval",
            goal: "Create a Claude Code session",
            source: "copilot",
          },
          events: [
            {
              id: "event-tool-call",
              runId: "run-1",
              type: "tool_call_requested",
              sequence: 1,
              message: "openforge.propose_session_create",
            },
            {
              id: "event-tool-result",
              runId: "run-1",
              type: "tool_result",
              sequence: 2,
              message: "openforge.propose_session_create",
              payload: {
                output: {
                  actionId: "action-1",
                  type: "openforge.propose_session_create",
                  status: "pending",
                },
              },
            },
          ],
          pendingActions: [
            {
              id: "action-1",
              runId: "run-1",
              type: "openforge.propose_session_create",
              status: "pending",
              input: {
                projectId: "project-1",
                aiTool: "claude",
                name: "Claude Code",
              },
            },
          ],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Create a Claude Code session");
  await page.getByRole("button", { name: "Send" }).click();

  const assistantBubble = page
    .getByText("Checking whether an existing session is available.")
    .locator("xpath=ancestor::article");
  await expect(assistantBubble).toBeVisible();
  await expect(assistantBubble.getByText("Tool requested")).toBeVisible();
  await expect(assistantBubble.getByText("openforge.propose_session_create").first()).toBeVisible();
  await expect(assistantBubble.getByText("Pending actions")).toBeVisible();
  await expect(assistantBubble.getByText("Session create")).toBeVisible();
  await expect(assistantBubble.getByText("claude / project-1")).toBeVisible();
  await expect(assistantBubble.getByRole("button", { name: "Approve" })).toBeVisible();
});

test("Copilot renders model-provider apply approvals with readable details", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Apply MiniMax to Claude Code",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "I found the provider and need approval before writing project config.",
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "waiting_for_approval",
            goal: "Apply MiniMax to Claude Code",
            source: "copilot",
          },
          events: [
            {
              id: "event-tool-call",
              runId: "run-1",
              type: "tool_call_requested",
              sequence: 1,
              message: "openforge.propose_model_provider_apply",
            },
          ],
          pendingActions: [
            {
              id: "action-1",
              runId: "run-1",
              type: "openforge.propose_model_provider_apply",
              status: "pending",
              input: {
                adapter: "claude",
                projectId: "project-1",
                providerProfileId: "provider-minimax-cn",
                modelProfileId: "model-minimax-m2",
                credentialId: "credential-mainland",
                reason: "Use MiniMax China for Claude Code.",
              },
            },
          ],
        }),
      });
    },
    onGetRun: async (route) => {
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-1",
            status: "waiting_for_approval",
            goal: "Apply MiniMax to Claude Code",
            source: "copilot",
          },
          events: [],
          pendingActions: [
            {
              id: "action-1",
              runId: "run-1",
              type: "openforge.propose_model_provider_apply",
              status: "pending",
              input: {
                adapter: "claude",
                projectId: "project-1",
                providerProfileId: "provider-minimax-cn",
                modelProfileId: "model-minimax-m2",
                credentialId: "credential-mainland",
                reason: "Use MiniMax China for Claude Code.",
              },
            },
          ],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Apply MiniMax to Claude Code");
  await page.getByRole("button", { name: "Send" }).click();

  const assistantBubble = page
    .getByText("I found the provider and need approval before writing project config.")
    .locator("xpath=ancestor::article");
  await expect(assistantBubble.getByText("Model provider apply")).toBeVisible();
  await expect(assistantBubble.getByText("claude / project-1 / provider-minimax-cn / model-minimax-m2")).toBeVisible();
  await expect(assistantBubble.getByText("credential-mainland / Use MiniMax China for Claude Code.")).toBeVisible();
});

test("Copilot renders approved model-provider apply results in the chat flow", async ({ page }) => {
  let approved = false;
  const waitingRunDetail = {
    run: {
      id: "run-1",
      status: "waiting_for_approval",
      goal: "Apply MiniMax to Claude Code",
      source: "copilot",
    },
    events: [
      {
        id: "event-tool-call",
        runId: "run-1",
        type: "tool_call_requested",
        sequence: 1,
        message: "openforge.propose_model_provider_apply",
      },
    ],
    pendingActions: [
      {
        id: "action-1",
        runId: "run-1",
        type: "openforge.propose_model_provider_apply",
        status: "pending",
        input: {
          adapter: "claude",
          projectId: "project-1",
          providerProfileId: "provider-minimax-cn",
          modelProfileId: "model-minimax-m2",
        },
      },
    ],
  };
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Apply MiniMax to Claude Code",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "I need approval before writing project config.",
              createdAt: 1778490000001,
            },
          ],
          ...waitingRunDetail,
        }),
      });
    },
    onGetRun: async (route) => {
      await route.fulfill({
        json: envelope(approved
          ? {
            run: {
              id: "run-1",
              status: "completed",
              goal: "Apply MiniMax to Claude Code",
              source: "copilot",
            },
            events: [],
            pendingActions: [],
          }
          : waitingRunDetail),
      });
    },
    onDecideAction: async (route) => {
      approved = true;
      await route.fulfill({
        json: envelope({
          action: {
            id: "action-1",
            runId: "run-1",
            type: "openforge.propose_model_provider_apply",
            status: "approved",
          },
          run: {
            id: "run-1",
            status: "completed",
            goal: "Apply MiniMax to Claude Code",
            source: "copilot",
          },
          events: [
            {
              id: "event-approved",
              runId: "run-1",
              type: "pending_action_approved",
              sequence: 2,
              message: "openforge.propose_model_provider_apply",
              payload: {
                actionId: "action-1",
                actionType: "openforge.propose_model_provider_apply",
                status: "approved",
                result: {
                  adapter: "claude",
                  projectId: "project-1",
                  changedFiles: [{ relativePath: ".claude/settings.local.json", operation: "create" }],
                  backupPath: "/tmp/openforge/.openforge/backups/model-provider-apply/2026-05-16",
                  secretEnvNames: ["ANTHROPIC_AUTH_TOKEN"],
                  executed: true,
                },
              },
            },
          ],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Apply MiniMax to Claude Code");
  await page.getByRole("button", { name: "Send" }).click();
  const assistantBubble = page.getByText("I need approval before writing project config.").locator("xpath=ancestor::article");
  await assistantBubble.getByRole("button", { name: "Approve" }).click();

  await expect(page.getByText("Action approved")).toBeVisible();
  await expect(page.getByText("claude / project-1 / executed")).toBeVisible();
  await expect(page.getByText(".claude/settings.local.json create / backup created / secrets: ANTHROPIC_AUTH_TOKEN")).toBeVisible();
});

test("Copilot renders recalled memory snippets in the assistant activity flow", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Use the remembered provider decision",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "I found a relevant provider decision and will use it as context.",
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "completed",
            goal: "Use the remembered provider decision",
            source: "copilot",
          },
          events: [
            {
              id: "event-memory-recalled",
              runId: "run-1",
              type: "memory_recalled",
              sequence: 1,
              message: "1 memory item recalled",
              payload: {
                results: [
                  {
                    id: "memory-1",
                    type: "entry",
                    scope: "global",
                    projectId: null,
                    snippet: "Provider configuration should treat provider profiles as the source of truth.",
                  },
                ],
              },
            },
          ],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Use the remembered provider decision");
  await page.getByRole("button", { name: "Send" }).click();

  const assistantBubble = page
    .getByText("I found a relevant provider decision and will use it as context.")
    .locator("xpath=ancestor::article");
  await expect(assistantBubble.getByText("Memory recalled")).toBeVisible();
  await expect(assistantBubble.getByText("Provider configuration should treat provider profiles as the source of truth.")).toBeVisible();
});

test("Copilot renders terminal snapshots from tool results in the assistant activity flow", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "What is in the terminal?",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "I checked the terminal snapshot.",
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "completed",
            goal: "What is in the terminal?",
            source: "copilot",
          },
          events: [
            {
              id: "event-terminal-result",
              runId: "run-1",
              type: "tool_result",
              sequence: 1,
              message: "openforge.get_session_terminal_snapshot",
              payload: {
                output: {
                  terminal: {
                    available: true,
                    text: "pwd\n/data/OpenForge\n",
                  },
                },
              },
            },
          ],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("What is in the terminal?");
  await page.getByRole("button", { name: "Send" }).click();

  const assistantBubble = page.getByText("I checked the terminal snapshot.").locator("xpath=ancestor::article");
  await expect(assistantBubble.getByText("Tool result")).toBeVisible();
  await expect(assistantBubble.getByText("pwd")).toBeVisible();
  await expect(assistantBubble.getByText("/data/OpenForge")).toBeVisible();
});

test("Copilot keeps showing progress while an async run has not returned events yet", async ({ page }) => {
  let sendCompleted = false;
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        status: 202,
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Check project state",
              createdAt: 1778490000000,
            },
          ],
          run: {
            id: "run-1",
            status: "running",
            goal: "Check project state",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
      sendCompleted = true;
    },
    onGetRun: async (route) => {
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-1",
            status: "running",
            goal: "Check project state",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Check project state");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => sendCompleted).toBe(true);
  await expect(page.getByText("Copilot is working...")).toBeVisible();
  await expect(page.getByText("Gateway is healthy.")).toHaveCount(0);
});

test("Copilot renders assistant delta events before the final run response", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        status: 202,
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Stream the answer",
              createdAt: 1778490000000,
            },
          ],
          run: {
            id: "run-1",
            status: "running",
            goal: "Stream the answer",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
    onGetRun: async (route) => {
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-1",
            status: "running",
            goal: "Stream the answer",
            source: "copilot",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Stream the answer");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Stream the answer" })).toHaveCount(1);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("openforge:gateway-event", {
      detail: {
        type: "copilot_run_updated",
        payload: {
          event_type: "assistant_delta",
          run_id: "run-1",
          conversation_id: "conversation-1",
          delta_text: "Streaming answer chunk.",
        },
      },
    }));
  });

  await expect(page.getByText("Streaming answer chunk.")).toBeVisible();
});

test("Copilot shows a failed run reason after approving a pending action", async ({ page }) => {
  await mockCopilotApis(page, {
    onSendMessage: async (route) => {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "message-user",
              conversationId: "conversation-1",
              role: "user",
              content: "Send pwd to the session",
              createdAt: 1778490000000,
            },
            {
              id: "message-assistant",
              conversationId: "conversation-1",
              runId: "run-1",
              role: "assistant",
              content: "I need approval before sending terminal input.",
              createdAt: 1778490000001,
            },
          ],
          run: {
            id: "run-1",
            status: "waiting_for_approval",
            goal: "Send pwd to the session",
            source: "copilot",
          },
          events: [
            {
              id: "event-tool-call",
              runId: "run-1",
              type: "tool_call_requested",
              sequence: 1,
              message: "openforge.propose_session_input",
            },
          ],
          pendingActions: [
            {
              id: "action-1",
              runId: "run-1",
              type: "openforge.propose_session_input",
              status: "pending",
              input: {
                sessionId: "session-1",
                input: "pwd",
                submit: true,
              },
            },
          ],
        }),
      });
    },
    onGetRun: async (route) => {
      await route.fulfill({
        json: envelope({
          run: {
            id: "run-1",
            status: "waiting_for_approval",
            goal: "Send pwd to the session",
            source: "copilot",
          },
          events: [
            {
              id: "event-tool-call",
              runId: "run-1",
              type: "tool_call_requested",
              sequence: 1,
              message: "openforge.propose_session_input",
            },
          ],
          pendingActions: [
            {
              id: "action-1",
              runId: "run-1",
              type: "openforge.propose_session_input",
              status: "pending",
              input: {
                sessionId: "session-1",
                input: "pwd",
                submit: true,
              },
            },
          ],
        }),
      });
    },
    onDecideAction: async (route) => {
      await route.fulfill({
        json: envelope({
          action: {
            id: "action-1",
            runId: "run-1",
            type: "openforge.propose_session_input",
            status: "approved",
          },
          run: {
            id: "run-1",
            status: "failed",
            goal: "Send pwd to the session",
            source: "copilot",
            errorCode: "copilot_model_request_failed",
            errorMessage: "Continuation failed after approval",
          },
          events: [],
          pendingActions: [],
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByPlaceholder(/Ask Copilot/).fill("Send pwd to the session");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Approve" }).click();

  await expect(page.getByText("Copilot could not reach the selected model provider.")).toBeVisible();
});

test("Copilot memory panel lists, searches, and deletes memory", async ({ page }) => {
  let deleteMemoryPath = "";
  await mockCopilotApis(page, {
    initialMemoryEntries: [{
      id: "memory-1",
      type: "entry",
      userId: "user-e2e",
      kind: "provider-decision",
      scope: "global",
      projectId: null,
      redactedText: "Provider profiles are the source of truth for model configuration.",
    }],
    initialMemoryNotes: [{
      id: "note-1",
      type: "note",
      userId: "user-e2e",
      projectId: "project-1",
      sessionId: null,
      redactedText: "Project aether-glass prefers Claude Code for coding sessions.",
    }],
    memorySearchResults: [{
      id: "memory-1",
      type: "entry",
      scope: "global",
      projectId: null,
      snippet: "Provider profiles are the source of truth for model configuration.",
      rank: 1,
    }],
    onDeleteMemory: async (route) => {
      deleteMemoryPath = new URL(route.request().url()).pathname;
      await route.fulfill({
        json: envelope({
          item: {
            id: "memory-1",
            type: "entry",
            userId: "user-e2e",
            kind: "provider-decision",
            scope: "global",
            redactedText: "Provider profiles are the source of truth for model configuration.",
          },
        }),
      });
    },
  });

  await page.goto("/copilot");
  await page.getByRole("button", { name: "Memory" }).click();

  await expect(page.getByText("Provider profiles are the source of truth for model configuration.")).toBeVisible();
  await expect(page.getByText("Project aether-glass prefers Claude Code for coding sessions.")).toBeVisible();

  await page.getByPlaceholder("Search Copilot memory").fill("provider");
  await expect(page.getByText("Provider profiles are the source of truth for model configuration.")).toBeVisible();

  await page.getByRole("button", { name: "Delete memory" }).first().click();
  await expect.poll(() => deleteMemoryPath).toBe("/api/v1/copilot/memory/entry/memory-1");
});

test("Copilot drawer opens from the global shell", async ({ page }) => {
  await mockCopilotApis(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Open Copilot" }).click();

  await expect(page.getByPlaceholder(/Ask Copilot/).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(1);
});

test("Copilot drawer opens from the global shortcut", async ({ page }) => {
  await mockCopilotApis(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open Copilot" })).toBeVisible();
  await page.keyboard.press("Control+Shift+K");

  await expect(page.getByPlaceholder(/Ask Copilot/).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toHaveCount(1);
});

test("Copilot drawer sends project route context when opened from a project page", async ({ page }) => {
  let createConversationBody: Record<string, unknown> | undefined;
  let sendBody: Record<string, unknown> | undefined;
  await mockCopilotApis(page, {
    onCreateConversation: async (route) => {
      createConversationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: envelope({
          conversation: {
            id: "conversation-1",
            title: "Check project state",
            source: "project",
            sourceRefId: "project-123",
            status: "active",
          },
        }),
      });
    },
    onSendMessage: async (route) => {
      sendBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: envelope({ messages: [], run: {}, events: [], pendingActions: [] }) });
    },
  });

  await page.goto("/projects/project-123");
  await page.getByRole("button", { name: "Open Copilot" }).click();
  await page.getByPlaceholder(/Ask Copilot/).last().fill("Check project state");
  await page.getByRole("button", { name: "Send" }).click();

  await expect.poll(() => createConversationBody).toMatchObject({
    source: "project",
    sourceRefId: "project-123",
  });
  await expect.poll(() => sendBody).toMatchObject({
    prompt: "Check project state",
    source: "project",
    sourceRefId: "project-123",
  });
});

test("Copilot page does not render the global floating drawer trigger", async ({ page }) => {
  await mockCopilotApis(page);

  await page.goto("/copilot");

  await expect(page.getByRole("button", { name: "Open Copilot" })).toHaveCount(0);
});

async function mockCopilotApis(
  page: Page,
  overrides: {
    providerConfigured?: boolean;
    capabilitiesStatus?: number;
    initialConversations?: Array<Record<string, unknown>>;
    initialMessages?: Array<Record<string, unknown>>;
    onCreateConversation?: (route: Route) => Promise<void>;
    onSendMessage?: (route: Route) => Promise<void>;
    onGetRun?: (route: Route) => Promise<void>;
    onDecideAction?: (route: Route) => Promise<void>;
    initialMemoryEntries?: Array<Record<string, unknown>>;
    initialMemoryNotes?: Array<Record<string, unknown>>;
    memorySearchResults?: Array<Record<string, unknown>>;
    onDeleteMemory?: (route: Route) => Promise<void>;
  } = {}
) {
  let conversations: Array<Record<string, unknown>> = [...(overrides.initialConversations ?? [])];
  let messages: Array<Record<string, unknown>> = [...(overrides.initialMessages ?? [])];
  let memoryEntries: Array<Record<string, unknown>> = [...(overrides.initialMemoryEntries ?? [])];
  let memoryNotes: Array<Record<string, unknown>> = [...(overrides.initialMemoryNotes ?? [])];

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/v1/auth/me") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "copilot-e2e@example.com",
          role: "admin",
          status: "active",
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/copilot/capabilities") {
      if (overrides.capabilitiesStatus && overrides.capabilitiesStatus >= 400) {
        await route.fulfill({
          status: overrides.capabilitiesStatus,
          json: { code: 1, message: "Failed to load Copilot capabilities" },
        });
        return;
      }
      await route.fulfill({
        json: envelope({
          supportedProviderFormats: ["openai", "anthropic"],
          providerConfigured: overrides.providerConfigured ?? true,
          toolExecutionEnabled: true,
          readTools: ["openforge.get_dashboard_summary"],
          prepareTools: ["openforge.propose_session_create", "openforge.propose_session_input"],
          approvalRequiredForWrites: true,
          pendingActionApprovalEnabled: true,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/projects/project-123" && method === "GET") {
      await route.fulfill({
        json: envelope({
          project: {
            id: "project-123",
            name: "Project 123",
            path: "/workspace/project-123",
            rootPath: "/workspace/project-123",
            aiTool: "claude",
            status: "active",
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/projects/project-123/agent-sequence" && method === "GET") {
      await route.fulfill({ json: envelope({ sequence: [] }) });
      return;
    }

    if (
      (url.pathname === "/api/v1/projects/project-123/ai-config" ||
        url.pathname === "/api/v1/projects/project-123/ai-config/global") &&
      method === "GET"
    ) {
      await route.fulfill({
        json: envelope({
          adapter: "claude",
          projectRoot: "/workspace/project-123",
          files: [],
          forms: [],
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/projects/project-123/skills" && method === "GET") {
      await route.fulfill({ json: envelope({ skills: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/sessions" && method === "GET") {
      await route.fulfill({ json: envelope({ sessions: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/agents" && method === "GET") {
      await route.fulfill({ json: envelope({ agents: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/skills" && method === "GET") {
      await route.fulfill({ json: envelope({ skills: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/models" && method === "GET") {
      await route.fulfill({ json: envelope({ models: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/api-keys" && method === "GET") {
      await route.fulfill({ json: envelope({ apiKeys: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/templates" && method === "GET") {
      await route.fulfill({ json: envelope({ templates: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/adapters/discovery" && method === "GET") {
      await route.fulfill({
        json: envelope({
          adapters: [{
            id: "claude",
            label: "Claude Code",
            command: "claude",
            supportLevel: "supported",
            launchEnabled: true,
            configDir: "~/.claude",
            runtimeModes: ["terminal"],
            available: true,
            status: "available",
          }],
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/copilot/memory/entries" && method === "GET") {
      await route.fulfill({ json: envelope({ entries: memoryEntries }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/memory/notes" && method === "GET") {
      await route.fulfill({ json: envelope({ notes: memoryNotes }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/memory/search" && method === "GET") {
      await route.fulfill({ json: envelope({ results: overrides.memorySearchResults ?? [] }) });
      return;
    }

    if (url.pathname.startsWith("/api/v1/copilot/memory/") && method === "DELETE") {
      if (overrides.onDeleteMemory) {
        await overrides.onDeleteMemory(route);
      } else {
        const [, , , , , type, id] = url.pathname.split("/");
        if (type === "entry") memoryEntries = memoryEntries.filter((entry) => entry.id !== id);
        if (type === "note") memoryNotes = memoryNotes.filter((note) => note.id !== id);
        await route.fulfill({ json: envelope({ item: { id, type } }) });
      }
      return;
    }

    if (url.pathname === "/api/v1/copilot/conversations" && method === "GET") {
      await route.fulfill({ json: envelope({ conversations }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/conversations" && method === "POST") {
      if (overrides.onCreateConversation) {
        await overrides.onCreateConversation(route);
      } else {
        await route.fulfill({
          json: envelope({
            conversation: {
              id: "conversation-1",
              title: "New conversation",
              source: "copilot",
              status: "active",
            },
          }),
        });
      }
      conversations = [{
        id: "conversation-1",
        title: "Summarize Gateway health",
        source: "copilot",
        status: "active",
      }];
      return;
    }

    if (url.pathname === "/api/v1/copilot/conversations/conversation-1/messages" && method === "GET") {
      await route.fulfill({ json: envelope({ messages }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/conversations/conversation-1/messages" && method === "POST") {
      if (overrides.onSendMessage) {
        await overrides.onSendMessage(route);
        return;
      } else {
        await route.fulfill({ json: envelope({ messages: [], run: {}, events: [], pendingActions: [] }) });
      }
      messages = [
        {
          id: "message-user",
          conversationId: "conversation-1",
          role: "user",
          content: "Summarize Gateway health",
        },
        {
          id: "message-assistant",
          conversationId: "conversation-1",
          role: "assistant",
          content: "Gateway is healthy.",
        },
      ];
      return;
    }

    if (url.pathname === "/api/v1/copilot/messages/message-user" && method === "DELETE") {
      messages = messages.filter((message) => message.id !== "message-user");
      await route.fulfill({ json: envelope({ message: { id: "message-user", deletedAt: Date.now() } }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/conversations/conversation-1" && method === "DELETE") {
      conversations = [];
      messages = [];
      await route.fulfill({ json: envelope({ conversation: { id: "conversation-1", status: "deleted" } }) });
      return;
    }

    if (url.pathname === "/api/v1/copilot/runs/run-1" && method === "GET") {
      if (overrides.onGetRun) {
        await overrides.onGetRun(route);
      } else {
        await route.fulfill({
          json: envelope({
            run: { id: "run-1", status: "completed", goal: "Summarize Gateway health", source: "copilot" },
            events: [],
            pendingActions: [],
          }),
        });
      }
      return;
    }

    if (url.pathname.startsWith("/api/v1/copilot/runs/") && url.pathname.includes("/pending-actions/")) {
      if (overrides.onDecideAction) {
        await overrides.onDecideAction(route);
        return;
      }
      await route.fulfill({
        json: envelope({
          action: { id: "action-1", runId: "run-1", type: "openforge.propose_memory_write", status: "approved" },
          run: { id: "run-1", status: "completed", goal: "Approve action", source: "copilot" },
          events: [],
          pendingActions: [],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: {
        code: 1,
        message: `Unhandled mocked API route: ${method} ${url.pathname}`,
      },
    });
  });
}

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
