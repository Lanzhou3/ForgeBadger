import { expect, type Page, type Route } from "@playwright/test";

const PROJECT_ID = "project-123";

export async function mockProjectDetailApis(
  page: Page,
  overrides: {
    evidenceAttachStatus?: number;
    ledgerStatus?: number;
    onDeleteWorkItem?: (workItemId: string) => void;
    onLedgerLimit?: (limit: number) => void;
    projectManagerStatus?: number;
  } = {}
) {
  const unhandledApiRoutes: string[] = [];
  let goal = {
    id: "goal-1",
    projectId: PROJECT_ID,
    summary: "Ship v1.2 Project Manager workflow",
    constraints: ["No Gateway authority changes"],
    acceptanceCriteria: ["Project Manager tab renders"],
    status: "active",
    createdAt: 1779370000000,
    updatedAt: 1779373600000,
  };
  let workItems = [{
    id: "work-item-1",
    projectId: PROJECT_ID,
    title: "Expose Project Manager tab",
    description: null,
    status: "in_progress",
    priority: 10,
    acceptanceCriteria: ["Tab is visible"],
    evidenceRefCount: 1,
    evidenceRefs: [{ kind: "test", ref: "project-manager.spec.ts" }],
    feishuRefCount: 0,
    createdAt: 1779370000000,
    updatedAt: 1779373600000,
  }, {
    id: "work-item-2",
    projectId: PROJECT_ID,
    title: "Review external evidence",
    description: "Confirm beta evidence caveats",
    status: "blocked",
    priority: 5,
    acceptanceCriteria: ["Caveats remain explicit"],
    evidenceRefCount: 0,
    evidenceRefs: [],
    feishuRefCount: 1,
    createdAt: 1779370000000,
    updatedAt: 1779373600000,
  }, {
    id: "work-item-3",
    projectId: PROJECT_ID,
    title: "Draft release note",
    description: "Summarize the local UI workflow",
    status: "in_progress",
    priority: 3,
    acceptanceCriteria: ["Release note is concise"],
    evidenceRefCount: 0,
    evidenceRefs: [],
    feishuRefCount: 0,
    createdAt: 1779370000000,
    updatedAt: 1779373600000,
  }, {
    id: "work-item-trace",
    projectId: PROJECT_ID,
    title: "Trace Copilot approval chain",
    description: "Show the done status with trusted evidence and the ledger marker.",
    status: "done",
    priority: 9,
    acceptanceCriteria: ["Trace markers are visible"],
    evidenceRefCount: 2,
    evidenceRefs: [{
      kind: "test",
      label: "Initial trace",
      status: "draft",
      ref: "PW-TRACE-OLD",
      sessionId: "session-old",
      copilotRunId: "run-old-1",
      pendingActionId: "pm-action-old",
      rawTerminal: "RAW TERMINAL OUTPUT SHOULD NOT RENDER",
    }, {
      kind: "test",
      label: "Traceability E2E",
      status: "verified",
      ref: "PW-TRACE-1",
      sessionId: "session-trace-1",
      copilotRunId: "run-evidence-1",
      pendingActionId: "pm-action-evidence",
      rawTerminal: "RAW TERMINAL OUTPUT SHOULD NOT RENDER",
    }],
    feishuRefCount: 0,
    createdAt: 1779370000000,
    updatedAt: 1779374200000,
  }];

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname === "/api/v1/auth/me" && method === "GET") {
      await route.fulfill({
        json: envelope({
          id: "user-e2e",
          email: "project-manager-e2e@example.com",
          role: "admin",
          status: "active",
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/notifications" && method === "GET") {
      await route.fulfill({ json: envelope({ notifications: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/model-providers" && method === "GET") {
      await route.fulfill({ json: envelope({ providers: [], models: [], credentials: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}` && method === "GET") {
      await route.fulfill({
        json: envelope({
          project: {
            id: PROJECT_ID,
            name: "Project Manager E2E",
            path: "/workspace/project-manager-e2e",
            rootPath: "/workspace/project-manager-e2e",
            aiTool: "claude",
            status: "active",
          },
        }),
      });
      return;
    }

    if (
      (url.pathname === `/api/v1/projects/${PROJECT_ID}/ai-config` ||
        url.pathname === `/api/v1/projects/${PROJECT_ID}/ai-config/global`) &&
      method === "GET"
    ) {
      await route.fulfill({
        json: envelope({
          adapter: "claude",
          projectRoot: "/workspace/project-manager-e2e",
          files: [],
          forms: [],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/skills` && method === "GET") {
      await route.fulfill({ json: envelope({ skills: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/workspace/tree` && method === "GET") {
      await route.fulfill({
        json: envelope({
          projectId: PROJECT_ID,
          rootPath: "/workspace/project-manager-e2e",
          path: "",
          truncated: false,
          entries: [],
        }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/workspace/file` && method === "GET") {
      await route.fulfill({
        json: envelope({
          projectId: PROJECT_ID,
          rootPath: "/workspace/project-manager-e2e",
          path: url.searchParams.get("path") ?? "",
          name: "workspace.txt",
          sizeBytes: 0,
          updatedAt: "2026-05-29T00:00:00.000Z",
          encoding: "utf8",
          content: "",
          truncated: false,
          binary: false,
        }),
      });
      return;
    }

    if (url.pathname === "/api/v1/sessions" && method === "GET") {
      expect(url.searchParams.get("projectId")).toBe(PROJECT_ID);
      await route.fulfill({ json: envelope({ sessions: [] }) });
      return;
    }

    if (url.pathname === "/api/v1/skills" && method === "GET") {
      await route.fulfill({ json: envelope({ skills: [] }) });
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

    if (url.pathname === "/api/v1/gate-a/dependencies" && method === "GET") {
      await route.fulfill({ json: envelope({ dependencies: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/task-packets` && method === "GET") {
      await route.fulfill({ json: envelope({ taskPackets: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/stages` && method === "GET") {
      await route.fulfill({ json: envelope({ stages: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-item-links` && method === "GET") {
      await route.fulfill({ json: envelope({ links: [] }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/goal` && method === "GET") {
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      await route.fulfill({
        json: envelope({ goal }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/goal` && method === "PUT") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        summary?: unknown;
        constraints?: unknown;
        acceptanceCriteria?: unknown;
        status?: unknown;
      };
      expect(typeof body.summary).toBe("string");
      expect(body.constraints).toEqual(["Stay in Project Manager tab", "Use Gateway route"]);
      expect(body.acceptanceCriteria).toEqual(["Updated goal is visible"]);
      expect(body.status).toBe("active");
      goal = {
        ...goal,
        summary: body.summary,
        constraints: body.constraints,
        acceptanceCriteria: body.acceptanceCriteria,
        status: body.status,
        updatedAt: 1779377200000,
      } as typeof goal;
      await route.fulfill({ json: envelope({ goal }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items` && method === "GET") {
      expect(url.searchParams.get("limit")).toBe("50");
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      const status = url.searchParams.get("status");
      const filteredWorkItems = status
        ? workItems.filter((item) => item.status === status)
        : workItems;
      await route.fulfill({
        json: envelope({ workItems: filteredWorkItems }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items` && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        title?: unknown;
        description?: unknown;
        priority?: unknown;
        status?: unknown;
        acceptanceCriteria?: unknown;
        evidenceRefs?: unknown;
        feishuRefs?: unknown;
      };
      expect(body).toEqual({
        title: "Confirm trial packet",
        description: "Check the first-user packet before milestone close.",
        priority: 7,
        status: "blocked",
        acceptanceCriteria: ["Created item is visible", "References stay bounded"],
        evidenceRefs: [{
          kind: "report",
          label: "Trial checklist",
          ref: "TRIAL-1",
          path: "docs/TRIAL-CHECKLIST.md",
        }],
        feishuRefs: [{
          kind: "message",
          label: "Feishu approval",
          ref: "om_999",
          feishuMessageId: "om_msg_999",
        }],
      });
      const createdWorkItem = {
        id: "work-item-created",
        projectId: PROJECT_ID,
        title: body.title as string,
        description: body.description as string,
        status: body.status as string,
        priority: body.priority as number,
        acceptanceCriteria: body.acceptanceCriteria as string[],
        evidenceRefCount: 1,
        evidenceRefs: [{
          kind: "report",
          label: "Trial checklist",
          ref: "TRIAL-1",
          path: "docs/TRIAL-CHECKLIST.md",
        }],
        feishuRefCount: 1,
        createdAt: 1779377600000,
        updatedAt: 1779377600000,
      };
      workItems = [...workItems, createdWorkItem];
      await route.fulfill({ json: envelope({ workItem: createdWorkItem }) });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items/batch/status` && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        updates?: Array<{ workItemId?: unknown; status?: unknown }>;
      };
      expect(body).toEqual({
        updates: [
          { workItemId: "work-item-1", status: "ready_for_review" },
          { workItemId: "work-item-3", status: "ready_for_review" },
        ],
      });
      const targetIds = new Set(body.updates?.map((update) => update.workItemId));
      workItems = workItems.map((item) => targetIds.has(item.id)
        ? { ...item, status: "ready_for_review", updatedAt: 1779379700000 }
        : item);
      await route.fulfill({
        json: envelope({
          workItems: workItems.filter((item) => targetIds.has(item.id)),
        }),
      });
      return;
    }

    const editMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)$`)
    );
    if (editMatch && method === "PATCH") {
      const workItemId = decodeURIComponent(editMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        title?: unknown;
        description?: unknown;
        priority?: unknown;
        acceptanceCriteria?: unknown;
      };
      expect(workItemId).toBe("work-item-2");
      expect(body).toEqual({
        title: "Review external evidence packet",
        description: "Confirm beta evidence caveats before trial.",
        priority: 8,
        acceptanceCriteria: ["Caveats remain explicit", "Board edit is saved"],
      });
      workItems = workItems.map((item) => item.id === workItemId
        ? {
          ...item,
          title: body.title as string,
          description: body.description as string,
          priority: body.priority as number,
          acceptanceCriteria: body.acceptanceCriteria as string[],
          updatedAt: 1779379600000,
        }
        : item);
      await route.fulfill({
        json: envelope({ workItem: workItems.find((item) => item.id === workItemId) }),
      });
      return;
    }

    const deleteMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)$`)
    );
    if (deleteMatch && method === "DELETE") {
      const workItemId = decodeURIComponent(deleteMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        confirm?: unknown;
      };
      expect(workItemId).toBe("work-item-2");
      expect(body).toEqual({ confirm: true });
      const deletedWorkItem = workItems.find((item) => item.id === workItemId);
      expect(deletedWorkItem).toBeTruthy();
      workItems = workItems.filter((item) => item.id !== workItemId);
      overrides.onDeleteWorkItem?.(workItemId);
      await route.fulfill({ json: envelope({ workItem: deletedWorkItem }) });
      return;
    }

    const statusMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)/status$`)
    );
    if (statusMatch && method === "PATCH") {
      const workItemId = decodeURIComponent(statusMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        status?: unknown;
        manualCompletionReason?: unknown;
      };
      if (workItemId === "work-item-1") {
        expect(body).toEqual({ status: "ready_for_review" });
      }
      if (workItemId === "work-item-3") {
        expect(body).toEqual({
          status: "done",
          manualCompletionReason: "Local checklist item completed without external evidence.",
        });
      }
      const updatedWorkItem = workItems.find((item) => item.id === workItemId);
      expect(updatedWorkItem).toBeTruthy();
      workItems = workItems.map((item) => item.id === workItemId
        ? { ...item, status: body.status as string, updatedAt: 1779378800000 }
        : item);
      await route.fulfill({
        json: envelope({ workItem: workItems.find((item) => item.id === workItemId) }),
      });
      return;
    }

    const evidenceMatch = url.pathname.match(
      new RegExp(`^/api/v1/projects/${PROJECT_ID}/project-manager/work-items/([^/]+)/evidence$`)
    );
    if (evidenceMatch && method === "POST") {
      if (overrides.evidenceAttachStatus && overrides.evidenceAttachStatus >= 400) {
        await route.fulfill({
          status: overrides.evidenceAttachStatus,
          json: {
            code: 1,
            message: "Could not attach evidence reference.",
          },
        });
        return;
      }
      const workItemId = decodeURIComponent(evidenceMatch[1]);
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        evidenceRefs?: unknown;
      };
      const evidenceRefs = Array.isArray(body.evidenceRefs) ? body.evidenceRefs : [];
      expect(evidenceRefs.length).toBe(1);
      assertProjectManagerEvidenceRef(evidenceRefs[0]);
      const updatedWorkItem = workItems.find((item) => item.id === workItemId);
      expect(updatedWorkItem).toBeTruthy();
      workItems = workItems.map((item) => item.id === workItemId
        ? {
          ...item,
          evidenceRefCount: item.evidenceRefCount + 1,
          evidenceRefs: [
            ...item.evidenceRefs,
            evidenceRefs[0],
          ],
          updatedAt: 1779379000000,
        }
        : item);
      await route.fulfill({
        json: envelope({ workItem: workItems.find((item) => item.id === workItemId) }),
      });
      return;
    }

    if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/ledger` && method === "GET") {
      const ledgerLimit = Number(url.searchParams.get("limit"));
      expect(ledgerLimit).toBeGreaterThanOrEqual(25);
      overrides.onLedgerLimit?.(ledgerLimit);
      if (overrides.ledgerStatus && overrides.ledgerStatus >= 400) {
        await route.fulfill({
          status: overrides.ledgerStatus,
          json: {
            code: 1,
            message: "Could not load ledger events.",
          },
        });
        return;
      }
      if (overrides.projectManagerStatus && overrides.projectManagerStatus >= 400) {
        await fulfillProjectManagerError(route, overrides.projectManagerStatus);
        return;
      }
      const evidenceAttachedEvent = workItems.some((item) =>
        item.evidenceRefs.some((ref) => ref.ref === "PMEV-01")
      )
        ? [{
          id: "ledger-2",
          projectId: PROJECT_ID,
          workItemId: "work-item-2",
          eventType: "evidence_attached",
          evidenceRefCount: 1,
          feishuRefCount: 1,
          createdAt: 1779379000000,
        }]
        : [];
      await route.fulfill({
        json: envelope({
          events: projectManagerLedgerEvents(ledgerLimit, evidenceAttachedEvent),
        }),
      });
      return;
    }

    const unhandledRoute = `${method} ${url.pathname}${url.search}`;
    unhandledApiRoutes.push(unhandledRoute);
    await route.fulfill({
      status: 404,
      json: {
        code: 1,
        message: `Unhandled mocked API route: ${unhandledRoute}`,
      },
    });
  });

  return unhandledApiRoutes;
}

function projectManagerLedgerEvents(limit: number, evidenceAttachedEvent: unknown[]) {
  const baseEvents = [
    ...evidenceAttachedEvent,
    {
      id: "ledger-trace-old",
      projectId: PROJECT_ID,
      workItemId: "work-item-trace",
      eventType: "copilot_observation_recorded",
      status: "in_progress",
      evidenceRefCount: 1,
      feishuRefCount: 0,
      trace: {
        copilotRunId: "run-old-1",
        pendingActionId: "pm-action-old",
        actionType: "attach_evidence",
        targetType: "work_item",
        targetId: "work-item-trace",
        evidenceRefCount: 1,
        approvalStatus: "approved",
        executionStatus: "succeeded",
      },
      createdAt: 1779374100000,
    },
    {
      id: "ledger-trace",
      projectId: PROJECT_ID,
      workItemId: "work-item-trace",
      eventType: "copilot_observation_recorded",
      status: "done",
      evidenceRefCount: 2,
      feishuRefCount: 0,
      trace: {
        copilotRunId: "run-done-1",
        pendingActionId: "pm-action-done",
        actionType: "update_work_item_status",
        targetType: "work_item",
        targetId: "work-item-trace",
        evidenceRefCount: 2,
        approvalStatus: "approved",
        executionStatus: "succeeded",
      },
      details: {
        rawTerminal: "RAW TERMINAL OUTPUT SHOULD NOT RENDER",
        providerPayload: "RAW PROVIDER PAYLOAD SHOULD NOT RENDER",
        rawLedgerDetails: "RAW LEDGER DETAILS SHOULD NOT RENDER",
      },
      createdAt: 1779374300000,
    },
    {
            id: "ledger-1",
            projectId: PROJECT_ID,
            workItemId: "work-item-1",
            eventType: "work_item_status_changed",
            status: "in_progress",
            evidenceRefCount: 1,
            feishuRefCount: 0,
            createdAt: 1779373600000,
    },
    {
      id: "ledger-3",
      projectId: PROJECT_ID,
      workItemId: "work-item-2",
      eventType: "evidence_attached",
      status: null,
      evidenceRefCount: 1,
      feishuRefCount: 1,
      createdAt: 1779373700000,
    },
    {
      id: "ledger-4",
      projectId: PROJECT_ID,
      workItemId: "work-item-3",
      eventType: "manual_completion_recorded",
      status: "done",
      evidenceRefCount: 0,
      feishuRefCount: 0,
      createdAt: 1779373800000,
    },
    {
      id: "ledger-5",
      projectId: PROJECT_ID,
      workItemId: "work-item-2",
      eventType: "blocker_recorded",
      status: "blocked",
      evidenceRefCount: 0,
      feishuRefCount: 1,
      createdAt: 1779373900000,
    },
    {
      id: "ledger-6",
      projectId: PROJECT_ID,
      workItemId: "work-item-2",
      eventType: "blocker_resolved",
      status: "in_progress",
      evidenceRefCount: 1,
      feishuRefCount: 1,
      createdAt: 1779374000000,
    },
  ];
  const extendedEvents = limit >= 50
    ? [
      ...baseEvents,
      {
        id: "ledger-7",
        projectId: PROJECT_ID,
        workItemId: "work-item-1",
        eventType: "next_step_proposed",
        status: "ready_for_review",
        evidenceRefCount: 1,
        feishuRefCount: 0,
        createdAt: 1779374100000,
      },
    ]
    : baseEvents;

  return extendedEvents;
}

async function fulfillProjectManagerError(route: Route, status: number) {
  await route.fulfill({
    status,
    json: {
      code: 1,
      message: status === 404
        ? "Project manager state was not found for this project."
        : "Could not load project manager state.",
    },
  });
}

function assertProjectManagerEvidenceRef(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Expected evidence reference object");
  }
  const ref = value as Record<string, unknown>;
  if (ref.kind === "report") {
    expect(ref).toEqual({
      kind: "report",
      label: "Phase 11 evidence",
      ref: "PMEV-01",
      path: "docs/reports/phase-11-evidence.md",
    });
    return;
  }
  if (ref.kind === "file_path") {
    expect(ref).toEqual({
      kind: "file_path",
      label: "File path",
      path: "packages/web/src/components/projects/WorkspaceContextPanel.tsx",
    });
    return;
  }
  if (ref.kind === "terminal_snapshot") {
    expect(ref).toEqual({
      kind: "terminal_snapshot",
      label: "Terminal snapshot",
      ref: "terminal-snapshot:session-trace-1:latest",
      sessionId: "session-trace-1",
    });
    return;
  }
  if (ref.kind === "session") {
    expect(ref).toEqual({
      kind: "session",
      label: "Session",
      ref: "session:session-trace-1",
      sessionId: "session-trace-1",
    });
    return;
  }
  throw new Error(`Unexpected evidence reference kind: ${String(ref.kind)}`);
}

function envelope(data: unknown) {
  return { code: 0, data, message: "" };
}
