import { expect, test, type Page } from "@playwright/test";

const CONVERSATION_ID = "conv-e2e-1";

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}

async function mockCopilotApis(page: Page) {
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
    if (url.pathname === "/api/v1/notifications") {
      await route.fulfill({ json: envelope({ notifications: [] }) });
      return;
    }
    if (url.pathname === "/api/v1/copilot/conversations" && method === "GET") {
      await route.fulfill({
        json: envelope({
          conversations: [
            {
              id: CONVERSATION_ID,
              title: "Release planning",
              status: "active",
              created_at: 1779370000000,
              updated_at: 1779373600000,
            },
          ],
        }),
      });
      return;
    }
    if (
      url.pathname === `/api/v1/copilot/conversations/${CONVERSATION_ID}/messages` &&
      method === "GET"
    ) {
      await route.fulfill({
        json: envelope({
          messages: [
            {
              id: "msg-1",
              conversationId: CONVERSATION_ID,
              userId: "user-e2e",
              role: "user",
              kind: "text",
              content: "How is the release doing?",
              sequence: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
            },
            {
              id: "msg-2",
              conversationId: CONVERSATION_ID,
              userId: "user-e2e",
              role: "assistant",
              kind: "text",
              content: "All milestones are on track.",
              sequence: 2,
              createdAt: "2026-05-21T00:00:10.000Z",
            },
          ],
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/copilot/capabilities" && method === "GET") {
      await route.fulfill({
        json: envelope({
          tools: [
            {
              name: "list_projects",
              description: "List projects",
              risk: "read",
              requiresApproval: false,
              enabled: true,
            },
          ],
        }),
      });
      return;
    }
    if (url.pathname === "/api/v1/model-providers" && method === "GET") {
      await route.fulfill({
        json: envelope({
          providers: [],
          credentials: [],
          models: [
            {
              id: "model-1",
              providerProfileId: "provider-1",
              providerKey: "openai",
              providerName: "OpenAI",
              baseUrl: null,
              name: "gpt-5",
              modelId: "gpt-5",
              capabilities: [],
              status: "active",
              isDefault: true,
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { code: 1, message: `Unhandled mocked API route: ${method} ${url.pathname}` },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("forgebadger-language", "en");
    window.localStorage.setItem("forgebadger.token", "e2e-token");
    window.localStorage.setItem(
      "forgebadger.user",
      JSON.stringify({
        id: "user-e2e",
        email: "copilot-e2e@example.com",
        role: "admin",
        status: "active",
      })
    );
  });
  await mockCopilotApis(page);
});

test("keeps Copilot as the sole assistant workspace", async ({ page }) => {
  await page.goto("/copilot");

  await expect(page.getByRole("link", { name: "Copilot" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Portfolio Operations" })).toHaveCount(0);
  await expect(page.getByText("How is the release doing?")).toBeVisible();
  await expect(page.getByText("All milestones are on track.")).toBeVisible();
  const status = page.getByTestId("copilot-status-bar");
  await expect(status).toContainText("OpenAI / gpt-5");
  await expect(status).toContainText("Gateway native");
  await expect(page).toHaveURL(/\/copilot$/u);
});

test("shows only Gateway-native Copilot settings and tool capabilities", async ({ page }) => {
  await page.goto("/copilot/settings");

  await expect(page.getByRole("heading", { name: "Copilot Settings" })).toBeVisible();
  await expect(page.getByText("Gateway native")).toBeVisible();
  await expect(page.getByText(/no external Harness service/u)).toBeVisible();
  await expect(page.getByTestId("tool-row-list_projects")).toBeVisible();
});

test("does not expose the retired Portfolio workspace", async ({ page }) => {
  const response = await page.goto("/portfolio");

  expect(response?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
