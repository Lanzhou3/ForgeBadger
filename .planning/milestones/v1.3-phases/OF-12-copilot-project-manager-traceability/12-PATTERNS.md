# Phase 12: Copilot Project-Manager Traceability - Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 18
**Analogs found:** 16 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/gateway/src/services/copilot/read-tools.ts` | service | request-response, transform | `packages/gateway/src/services/copilot/read-tools.ts` | exact |
| `packages/gateway/src/routes/copilot.ts` | route/controller | request-response, event-driven | `packages/gateway/src/routes/copilot.ts` | exact |
| `packages/gateway/src/routes/project-manager.ts` | route/controller | request-response, CRUD, transform | `packages/gateway/src/routes/project-manager.ts` | exact |
| `packages/gateway/src/db/repositories/project-manager-repository.ts` | repository/model | CRUD, transaction | `packages/gateway/src/db/repositories/project-manager-repository.ts` | exact |
| `packages/web/src/lib/api.ts` | utility/client | request-response, transform | `packages/web/src/lib/api.ts` | exact |
| `packages/web/src/lib/copilot.ts` | utility | transform | `packages/web/src/lib/copilot.ts` | exact |
| `packages/web/src/components/copilot/copilot-chat-panel.tsx` | component | event-driven, request-response | `packages/web/src/components/copilot/copilot-chat-panel.tsx` | exact |
| `packages/web/src/components/projects/ProjectManagerPanel.tsx` | component | CRUD, event-driven | `packages/web/src/components/projects/ProjectManagerPanel.tsx` | exact |
| `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` | route/component | URL state, request-response | `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` | partial |
| `packages/web/src/lib/i18n.ts` | config | transform | `packages/web/src/lib/i18n.ts` | exact |
| `packages/gateway/test/copilot-tools.test.ts` | test | request-response, transform | `packages/gateway/test/copilot-tools.test.ts` | exact |
| `packages/gateway/test/copilot-routes.test.ts` | test | request-response, event-driven | `packages/gateway/test/copilot-routes.test.ts` | exact |
| `packages/gateway/test/project-manager-repository.test.ts` | test | CRUD, transaction | `packages/gateway/test/project-manager-repository.test.ts` | exact |
| `packages/gateway/test/project-manager-routes.test.ts` | test | request-response, CRUD | `packages/gateway/test/project-manager-routes.test.ts` | exact |
| `packages/web/src/lib/api.test.ts` | test | request-response, transform | `packages/web/src/lib/api.test.ts` | exact |
| `packages/web/src/lib/copilot.test.ts` | test | transform | `packages/web/src/lib/copilot.test.ts` | exact |
| `packages/web/e2e/copilot.spec.ts` | test | event-driven, request-response | `packages/web/e2e/copilot.spec.ts` | exact |
| `packages/web/e2e/project-manager.spec.ts` | test | CRUD, request-response | `packages/web/e2e/project-manager.spec.ts` | exact |

## Pattern Assignments

### `packages/gateway/src/services/copilot/read-tools.ts` (service, request-response/transform)

**Analog:** `packages/gateway/src/services/copilot/read-tools.ts`

**Imports and PM read model pattern** (lines 1-18):
```typescript
import { z } from "zod";
import {
  PROJECT_MANAGER_LEDGER_EVENT_TYPES,
  PROJECT_MANAGER_WORK_ITEM_STATUSES,
  ProjectManagerRepository,
  type ProjectManagerEvidenceRef,
  type ProjectManagerGoal,
  type ProjectManagerLedgerEvent,
  type ProjectManagerLedgerEventType,
  type ProjectManagerWorkItem
} from "../../db/repositories/project-manager-repository.js";
```

**Strict tool input schemas** (lines 46-59, 71-83):
```typescript
const projectManagerWorkItemsInput = z.object({
  projectId: z.string().min(1),
  status: z.enum(PROJECT_MANAGER_WORK_ITEM_STATUSES).optional(),
  limit: z.number().int().min(1).max(50).optional()
}).strict();

const proposeProjectCreateInput = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  description: z.string().min(1).optional(),
  techStack: z.string().min(1).optional(),
  aiTool: z.enum(["claude", "opencode", "codex"]).optional(),
  templateId: z.string().min(1).optional()
}).strict();
```

**Tool definition pattern** (lines 956-964, 1174-1191):
```typescript
{
  name: "openforge.propose_project_create",
  description:
    "Prepare a new OpenForge project draft for user approval. This does not create directories or database records until the user approves it.",
  risk: "prepare",
  requiresApproval: true,
  inputSchema: proposeProjectCreateInput,
  modelInputSchema: proposeProjectCreateModelInputSchema,
  execute: async (input, context) =>
    createProjectCreateProposal(input, context)
}
```

**Project Manager read tools use visible project + user-scoped repository** (lines 1289-1324):
```typescript
const { projectId, workItemId } = projectManagerWorkItemInput.parse(input);
const project = getVisibleProject(context, projectId);
if (!project) return { workItem: null };
const workItem = new ProjectManagerRepository(context.db, context.userId).getWorkItem(project.id, workItemId);
return { workItem: workItem ? toProjectManagerWorkItemSummary(workItem) : null };
```

**Canonical pending proposal creation** (lines 1845-1863):
```typescript
function createPendingProposal(
  context: Pick<CopilotToolContext, "db" | "userId" | "runId">,
  type: string,
  input: unknown
) {
  if (!context.runId) {
    throw new Error("Copilot run is required for pending actions");
  }
  const action = new CopilotRepository(context.db, context.userId).createPendingAction(context.runId, {
    type,
    input: safeActionInput(input)
  });
  return {
    actionId: action.id,
    type: action.type,
    status: action.status,
    summary: "Pending user approval"
  };
}
```

**Redaction before pending-action storage** (lines 2378-2383):
```typescript
function safeActionInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const redacted = redactCopilotPayload(input);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  return redacted as Record<string, unknown>;
}
```

Apply this to the three PM prepare tools. Add exactly three `risk: "prepare"` definitions and creator functions that call `createPendingProposal`; do not call `ProjectManagerRepository.createWorkItem`, `updateWorkItemStatus`, or `attachEvidence` from tool execution.

---

### `packages/gateway/src/routes/copilot.ts` (route/controller, request-response/event-driven)

**Analog:** `packages/gateway/src/routes/copilot.ts`

**Imports/auth pattern** (lines 1-18):
```typescript
import { Router } from "express";
import { z } from "zod";

import { authenticate, type AuthenticatedRequest } from "../auth/middleware.js";
import type {
  CopilotPendingAction,
  CopilotRun,
  CopilotRunEvent
} from "../db/repositories/copilot-repository.js";
import { CopilotLiveRunConflictError, CopilotRepository } from "../db/repositories/copilot-repository.js";
```

**Approval route lifecycle** (lines 699-725, 754-780):
```typescript
const target = findPendingActionTarget(repo, req.params.id, req.params.actionId);
if (!target) return res.status(404).json({ code: 1, message: "Pending action not found" });
const action = target.action;
if (action.status !== "pending") {
  return sendPendingActionNotPending(res, "Pending action is not approvable", 409, action.status);
}
const claimed = repo.updatePendingActionIfStatus(action.id, "pending", { status: "processing" });
if (!claimed) {
  return sendPendingActionNotPending(res, "Pending action is not approvable", 409, repo.getPendingAction(action.id)?.status);
}
result = await (options.pendingActionApprover ?? approvePendingAction)(claimed, options, userIdFor(req));

const updated = repo.updatePendingActionIfStatusAndRunStatus(claimed.id, "processing", "waiting_for_approval", {
  status: "approved",
  result,
  approvedBy: userIdFor(req),
  approvedAt: Date.now()
});
recordPendingActionAudit(options.db, userIdFor(req), req.ip, claimed, "approved", result);
const decisionEvent = recordPendingActionDecision(repo, claimed, "approved", result);
```

**Current generic failure behavior to split for PM actions** (lines 726-739, 744-752):
```typescript
} catch {
  const cancelled = rejectClaimIfRunCancelled(repo, target.run.id, claimed.id);
  if (cancelled) return sendRunCancelledDuringApproval(res);
  repo.updatePendingActionIfStatus(claimed.id, "processing", {
    status: "pending",
    result: null,
    approvedBy: null,
    approvedAt: null
  });
  res.status(500).json({
    code: 1,
    message: "Failed to approve pending action",
    details: { code: "copilot_pending_action_approval_failed" }
  });
  return;
}
if (isApprovalError(result)) {
  repo.updatePendingActionIfStatus(claimed.id, "processing", {
    status: "pending",
    result: null,
    approvedBy: null,
    approvedAt: null
  });
  res.status(400).json({ code: 1, message: result.error.message, details: { code: result.error.code } });
  return;
}
```

Phase 12 PM execution errors must not copy this restore-to-pending behavior. Add a PM-specific branch that moves `processing -> failed` with a safe result, then returns an envelope error.

**Dispatcher pattern** (lines 1513-1613):
```typescript
async function approvePendingAction(
  action: CopilotPendingAction,
  options: CopilotRoutesOptions,
  userId: string
): Promise<Record<string, unknown>> {
  if (action.type === "openforge.propose_project_create") {
    return await approveCopilotProjectCreate(action, options, userId);
  }
  if (isFeishuPendingActionType(action.type)) {
    return await approveCopilotFeishuAction(action, options, userId);
  }
  return {
    error: {
      code: "copilot_pending_action_unsupported",
      message: "Copilot pending action type is not supported"
    }
  };
}
```

**Stored-payload validation and approval helper pattern** (lines 1829-1863):
```typescript
const parsed = projectCreateApprovalSchema.safeParse(action.input);
if (!parsed.success) {
  return projectCreateApprovalError(
    "copilot_project_create_invalid",
    "Copilot project draft is invalid"
  );
}

try {
  const project = new ProjectRepository(options.db, userId).create({
    name: parsed.data.name,
    path: rootPath,
    description: parsed.data.description,
    techStack: parsed.data.techStack,
    aiTool,
    templateId
  });
  return { project: toCopilotProjectPayload(project), executed: true };
} catch (error) {
  return projectCreateApprovalError(
    "copilot_project_create_failed",
    error instanceof Error ? error.message : "Failed to create project"
  );
}
```

Add PM approval helpers beside existing `approveCopilot*` helpers. They must parse `action.input`, revalidate project/work item ownership through user-scoped repositories, enforce Copilot-origin `done` trusted evidence, call `ProjectManagerRepository`, and return bounded result markers for Web summaries.

---

### `packages/gateway/src/routes/project-manager.ts` (route/controller, request-response/CRUD)

**Analog:** `packages/gateway/src/routes/project-manager.ts`

**Schema pattern** (lines 20-58):
```typescript
const evidenceRefSchema = z.object({
  kind: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(256).optional(),
  status: z.string().min(1).max(64).optional(),
  ref: z.string().min(1).max(512).optional(),
  path: z.string().min(1).max(512).optional(),
  sessionId: z.string().min(1).max(128).optional(),
  copilotRunId: z.string().min(1).max(128).optional(),
  feishuChatId: z.string().min(1).max(128).optional(),
  feishuMessageId: z.string().min(1).max(128).optional(),
  createdAt: z.string().min(1).max(64).optional()
}).strict();

const evidenceBodySchema = z.object({
  evidenceRefs: z.array(evidenceRefSchema).min(1).max(20)
}).strict();
```

Add `pendingActionId` to this evidence schema with the same bounded string rules as `copilotRunId`.

**Route + tenant visibility pattern** (lines 70-81, 135-164, 167-180):
```typescript
router.use(authenticate);

router.patch("/:projectId/project-manager/work-items/:workItemId/status", (req, res) => {
  const parse = statusBodySchema.safeParse(req.body ?? {});
  if (!parse.success) return sendInvalidInput(res);
  const userId = userIdFor(req);
  const project = requireProject(db, userId, req.params.projectId);
  if (!project) return sendProjectNotFound(res);
  const repo = new ProjectManagerRepository(db, userId);
  if (!repo.getWorkItem(project.id, req.params.workItemId)) return sendWorkItemNotFound(res);
  try {
    const workItem = repo.updateWorkItemStatus(project.id, req.params.workItemId, parse.data);
    res.json({ code: 0, data: { workItem: toWorkItemDto(workItem) }, message: "" });
  } catch (error) {
    sendMutationError(res, error, "Work item status update failed");
  }
});
```

**DTO pattern** (lines 208-250):
```typescript
function toWorkItemDto(workItem: ProjectManagerWorkItem) {
  return {
    id: workItem.id,
    projectId: workItem.projectId,
    title: workItem.title,
    status: workItem.status,
    evidenceRefCount: workItem.evidenceRefs.length,
    evidenceRefs: workItem.evidenceRefs.map(toEvidenceRefDto),
    feishuRefCount: workItem.feishuRefs.length,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt
  };
}

function toEvidenceRefDto(ref: ProjectManagerEvidenceRef) {
  return {
    kind: ref.kind,
    label: ref.label,
    status: ref.status,
    ref: ref.ref,
    path: ref.path,
    sessionId: ref.sessionId,
    copilotRunId: ref.copilotRunId,
    feishuMessageId: ref.feishuMessageId,
    createdAt: ref.createdAt
  };
}
```

Extend DTOs with `pendingActionId` and add a bounded `trace` DTO on ledger events. Do not expose raw `event.details`.

---

### `packages/gateway/src/db/repositories/project-manager-repository.ts` (repository/model, CRUD/transaction)

**Analog:** `packages/gateway/src/db/repositories/project-manager-repository.ts`

**Evidence/ledger types and allowlist** (lines 31-42, 73-83, 178-189):
```typescript
export interface ProjectManagerEvidenceRef {
  kind?: string | undefined;
  label?: string | undefined;
  status?: string | undefined;
  ref?: string | undefined;
  path?: string | undefined;
  sessionId?: string | undefined;
  copilotRunId?: string | undefined;
  feishuMessageId?: string | undefined;
  createdAt?: string | undefined;
}

const evidenceRefKeys = new Set([
  "kind",
  "label",
  "status",
  "ref",
  "path",
  "sessionId",
  "copilotRunId",
  "feishuMessageId",
  "createdAt"
]);
```

Add `pendingActionId` to both the interface and `evidenceRefKeys`, otherwise route acceptance or repository normalization will strip the field.

**Transaction pattern for projection + ledger + audit** (lines 266-307, 341-382, 385-414):
```typescript
const write = this.db.transaction(() => {
  this.db.prepare(`
    INSERT INTO project_manager_work_items (
      id, user_id, project_id, title, description, status, priority,
      acceptance_criteria_json, evidence_refs_json, feishu_refs_json,
      details_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(/* ... */);
  this.insertLedgerEvent(projectId, id, "work_item_created", status, item.evidenceRefs, item.feishuRefs, {
    status,
    evidenceRefCount: item.evidenceRefs.length,
    acceptanceCriteriaCount: item.acceptanceCriteria.length
  }, now);
  this.writeAudit("project_manager.work_item.create", "project_manager_work_item", id, {
    projectId,
    status,
    evidenceRefCount: item.evidenceRefs.length,
    acceptanceCriteriaCount: item.acceptanceCriteria.length
  });
});
write();
```

PM Copilot approvals must reuse these methods or add repository methods that preserve this single transaction boundary. Do not split projection, evidence, ledger, and audit across route-level manual writes.

**Done gate currently allows generic manual completion** (lines 347-354):
```typescript
const nextStatus = normalizeStatus(input.status);
validateTransition(existing.status, nextStatus);
const inputEvidenceRefs = normalizeEvidenceRefs(input.evidenceRefs ?? []);
const evidenceRefs = [...existing.evidenceRefs, ...inputEvidenceRefs];
const hasManualReason = typeof input.manualCompletionReason === "string" && input.manualCompletionReason.trim().length > 0;
if (nextStatus === "done" && evidenceRefs.length === 0 && !hasManualReason) {
  throw new Error("Marking done requires evidence references or a manual completion reason");
}
```

Copilot-origin `done` is stricter than this. Enforce the trusted existing evidence rule in `routes/copilot.ts` before repository mutation and do not send `manualCompletionReason` from Copilot PM actions.

**Ledger/audit redaction and normalization** (lines 486-524, 613-626):
```typescript
this.db.prepare(`
  INSERT INTO project_manager_ledger_events (
    id, user_id, project_id, work_item_id, event_type, status,
    evidence_refs_json, feishu_refs_json, details_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  randomUUID(),
  this.userId,
  projectId,
  workItemId,
  eventType,
  status,
  JSON.stringify(normalizeEvidenceRefs(evidenceRefs)),
  JSON.stringify(normalizeEvidenceRefs(feishuRefs)),
  JSON.stringify(normalizeDetails(details)),
  createdAt
);
```

Trace details should be count/marker based and pass through `normalizeDetails`; never persist prompt text, terminal output, provider payloads, or secrets.

---

### `packages/web/src/lib/api.ts` (utility/client, request-response/transform)

**Analog:** `packages/web/src/lib/api.ts`

**PM DTO shape** (lines 36-47, 122-131):
```typescript
export interface ProjectManagerEvidenceRef {
  kind?: string;
  label?: string;
  status?: string;
  ref?: string;
  path?: string;
  sessionId?: string;
  copilotRunId?: string;
  feishuMessageId?: string;
  createdAt?: string;
}

export interface ProjectManagerLedgerEvent {
  id: string;
  projectId: string;
  workItemId: string | null;
  eventType: ProjectManagerLedgerEventType;
  status: ProjectManagerWorkItemStatus | null;
  evidenceRefCount: number;
  feishuRefCount: number;
  createdAt: number;
}
```

Add `pendingActionId` and a safe `trace?: ProjectManagerLedgerTrace` DTO. Keep it typed; do not use arbitrary `details`.

**PM API helper pattern** (lines 1576-1657):
```typescript
export async function updateProjectManagerWorkItemStatus(
  projectId: string,
  workItemId: string,
  input: ProjectManagerWorkItemStatusInput
): Promise<{ workItem: ProjectManagerWorkItem }> {
  return fetchJson(projectManagerPath(projectId, `/work-items/${encodeURIComponent(workItemId)}/status`), {
    method: "PATCH",
    body: JSON.stringify(input),
  }) as Promise<{ workItem: ProjectManagerWorkItem }>;
}

export async function listProjectManagerLedger(
  projectId: string,
  params: { eventType?: ProjectManagerLedgerEventType; limit?: number } = {}
): Promise<{ events: ProjectManagerLedgerEvent[] }> {
  const searchParams = new URLSearchParams();
  if (params.eventType) searchParams.set("eventType", params.eventType);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  const query = searchParams.toString();
  return fetchJson(projectManagerPath(projectId, `/ledger${query ? `?${query}` : ""}`)) as Promise<{
    events: ProjectManagerLedgerEvent[];
  }>;
}
```

**Pending-action approval client** (lines 1924-1930):
```typescript
export async function approveCopilotPendingAction(
  runId: string,
  actionId: string
): Promise<CopilotPendingActionDecision> {
  return fetchJson(`/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`, {
    method: "POST",
  }) as Promise<CopilotPendingActionDecision>;
}
```

Use this client unchanged for approval execution; PM-specific behavior belongs in Gateway and rendering helpers.

---

### `packages/web/src/lib/copilot.ts` (utility, transform)

**Analog:** `packages/web/src/lib/copilot.ts`

**Label and localization key maps** (lines 36-68, 70-102):
```typescript
const pendingActionLabels: Record<string, string> = {
  "openforge.propose_project_create": "Project create",
  "openforge.propose_model_provider_apply": "Model provider apply",
  "openforge.propose_feishu_task_update": "Feishu task update",
};

const pendingActionLabelKeys: Record<string, TranslationKey> = {
  "openforge.propose_project_create": "copilot.pendingAction.projectCreate",
  "openforge.propose_model_provider_apply": "copilot.pendingAction.modelProviderApply",
  "openforge.propose_feishu_task_update": "copilot.pendingAction.feishuTaskUpdate",
};
```

Add PM action labels and keys here, then add matching `i18n.ts` keys in all locale blocks.

**Pending action summary switch** (lines 438-513):
```typescript
export function getCopilotPendingActionSummary(
  action: CopilotPendingActionSummaryInput
): CopilotPendingActionSummary | null {
  const payload = action.input ?? action.result ?? {};
  switch (action.type) {
    case "openforge.propose_project_create":
      return summarizeProjectCreate(payload);
    case "openforge.propose_model_provider_apply":
      return summarizeModelProviderApply(payload);
    default:
      return null;
  }
}
```

**Approved result summary switch** (lines 516-584):
```typescript
export function getCopilotEventResultSummary(
  event: CopilotEventResultSummaryInput
): CopilotPendingActionSummary | null {
  if (event.type !== "pending_action_approved") return null;
  const payload = readRecord(event.payload);
  const result = readRecord(payload?.result);
  if (!payload || !result) return null;
  const actionType = readString(payload, "actionType") ?? normalizeOptionalText(event.message) ?? "";
  switch (actionType) {
    case "openforge.propose_project_create":
      return summarizeProjectCreateResult(result);
    default:
      return null;
  }
}
```

**Summary helper style** (lines 861-905, 1461-1527):
```typescript
function summarizeProjectCreate(payload: Record<string, unknown>): CopilotPendingActionSummary {
  const detail = joinPresent([
    readString(payload, "aiTool") ?? "project",
    readString(payload, "path"),
  ]);
  return {
    detail,
    preview: previewText(readString(payload, "name")),
  };
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  return normalizeOptionalText(value);
}
```

PM summaries must be fixed field summaries from structured payloads. Do not fall back to raw JSON or model prose.

---

### `packages/web/src/components/copilot/copilot-chat-panel.tsx` (component, event-driven/request-response)

**Analog:** `packages/web/src/components/copilot/copilot-chat-panel.tsx`

**Imports pattern** (lines 1-65):
```typescript
"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  approveCopilotPendingAction,
  rejectCopilotPendingAction,
  type CopilotPendingAction,
  type CopilotRunEvent,
} from "@/lib/api";
import {
  getCopilotEventResultSummary,
  getCopilotPendingActionLabel,
  getCopilotPendingActionLabelKey,
} from "@/lib/copilot";
```

**Approval mutation pattern** (lines 291-312):
```typescript
const decidePendingActionMutation = useMutation({
  mutationFn: async ({ action, decision }: { action: CopilotPendingAction; decision: "approve" | "reject" }) =>
    decision === "approve"
      ? approveCopilotPendingAction(action.runId, action.id)
      : rejectCopilotPendingAction(action.runId, action.id),
  onSuccess: async (data) => {
    setActiveRun((current) => {
      const nextState = {
        run: data.run ?? current?.run ?? nextRun,
        events: data.events ?? current?.events ?? [],
        pendingActions: data.pendingActions ?? [],
      };
      return shouldKeepCurrentActiveRun(current, nextState) ? current : nextState;
    });
  },
});
```

**Pending action card shape** (lines 901-935):
```tsx
function PendingActionCard({ action, deciding, onDecide }: {
  action: CopilotPendingAction;
  deciding: boolean;
  onDecide: (action: CopilotPendingAction, decision: "approve" | "reject") => void;
}) {
  const { t } = useLanguage();
  const key = getCopilotPendingActionLabelKey(action.type);
  const label = key ? t(key) : getCopilotPendingActionLabel(action.type);
  const summary = getCopilotPendingActionSummary(action);
  return (
    <div className="space-y-3 rounded-md border border-border bg-background/70 p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {summary?.detail && <div className="mt-1 break-words text-xs text-muted-foreground">{summary.detail}</div>}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={deciding} onClick={() => onDecide(action, "reject")}>
          {t("copilot.reject")}
        </Button>
        <Button type="button" size="sm" disabled={deciding} onClick={() => onDecide(action, "approve")}>
          {t("copilot.approve")}
        </Button>
      </div>
    </div>
  );
}
```

Extend this with a PM-specific branch/helper while keeping the same compact card shell. Add disabled approve behavior for missing trusted evidence and render `View in Project Manager` using `Link` when approved result has a project/work item target.

**Approved result summary rendering** (lines 859-880):
```tsx
const resultSummary = getCopilotEventResultSummary(event);
{resultSummary && (
  <div className="mt-2 rounded-md border border-border bg-background/70 p-2 text-xs leading-5">
    <div className="break-words font-medium text-foreground">{resultSummary.detail}</div>
    {resultSummary.preview && (
      <div className="mt-0.5 break-words text-muted-foreground">{resultSummary.preview}</div>
    )}
  </div>
)}
```

---

### `packages/web/src/components/projects/ProjectManagerPanel.tsx` (component, CRUD/event-driven)

**Analog:** `packages/web/src/components/projects/ProjectManagerPanel.tsx`

**React Query and mutation invalidation pattern** (lines 150-193, 222-270):
```typescript
const workItemsQuery = useQuery({
  queryKey: ["project-manager", projectId, "work-items", { status: workItemStatusFilter, limit: WORK_ITEM_LIMIT }],
  queryFn: () => listProjectManagerWorkItems(projectId, createWorkItemQueryParams(workItemStatusFilter)),
  enabled: canLoad,
  retry: false,
});

const evidenceMutation = useMutation({
  mutationFn: ({ reference, workItemId }: { reference: ProjectManagerEvidenceRef; workItemId: string }) =>
    attachProjectManagerWorkItemEvidence(projectId, workItemId, { evidenceRefs: [reference] }),
  onSuccess: async () => {
    setEvidenceAttachError(null);
    setEvidenceDraft(createEvidenceDraft());
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "work-items"] }),
      queryClient.invalidateQueries({ queryKey: ["project-manager", projectId, "ledger"] }),
    ]);
  },
});
```

**Detail sheet evidence rendering extension point** (lines 804-887):
```tsx
<DetailField label={t("projects.projectManagerEvidenceRefs")}>
  {item.evidenceRefs.length > 0 ? (
    <ul className="space-y-2">
      {item.evidenceRefs.map((ref, index) => (
        <li key={`${ref.ref ?? ref.path ?? index}`} className="rounded-md border border-border/70 px-3 py-2 text-xs">
          {formatEvidenceRef(ref)}
        </li>
      ))}
    </ul>
  ) : (
    <span className="text-muted-foreground">-</span>
  )}
</DetailField>
```

Add a compact `Copilot trace` detail block beside evidence refs when any evidence or ledger trace has `copilotRunId` or `pendingActionId`.

**Ledger row marker pattern** (lines 1360-1407):
```tsx
function ProjectManagerLedgerRow({ event, t, workItemTitle }: {
  event: ProjectManagerLedgerEvent;
  t: Translate;
  workItemTitle: string;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/10 px-3 py-3">
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <LedgerDatum label={t("projects.projectManagerEvidenceRefs")} value={event.evidenceRefCount} />
        <LedgerDatum label={t("projects.projectManagerFeishuRefs")} value={event.feishuRefCount} />
      </div>
    </div>
  );
}

function LedgerDatum({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 px-2 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-xs tabular-nums">{value}</div>
    </div>
  );
}
```

Use `LedgerDatum` for bounded trace markers: run, action, action type, target, evidence count, approval, execution.

**Evidence formatter to extend** (lines 1584-1589):
```typescript
function formatEvidenceRef(ref: ProjectManagerEvidenceRef) {
  const parts = [ref.kind, ref.label, ref.status, ref.ref, ref.path, ref.sessionId, ref.copilotRunId, ref.feishuMessageId]
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "-";
}
```

Add `pendingActionId` to this display and prefer structured marker rows for trace blocks.

---

### `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` (route/component, URL state/request-response)

**Analog:** `packages/web/src/app/(dashboard)/projects/[id]/page.tsx`

**Current search param and tab state pattern** (lines 85-92, 329):
```typescript
const params = useParams();
const router = useRouter();
const searchParams = useSearchParams();
const id = params.id as string;
const [activeTab, setActiveTab] = useState("sessions");

const configNeedsReview = searchParams.get("configStatus") === "failed";
```

**Tab rendering pattern** (lines 859-928):
```tsx
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsList className="min-w-max">
    <TabsTrigger value="sessions">{t("nav.sessions")}</TabsTrigger>
    <TabsTrigger value="project-manager">{t("projects.projectManager")}</TabsTrigger>
    <TabsTrigger value="agents">{t("nav.agents")}</TabsTrigger>
  </TabsList>

  <TabsContent value="project-manager" className="mt-4">
    <ProjectManagerPanel
      projectId={id}
      enabled={activeTab === "project-manager"}
    />
  </TabsContent>
</Tabs>
```

No exact URL-tab analog exists. Add a small tab allowlist and initialize/sync from `searchParams.get("tab")`. For Phase 12 anchor, pass `workItemId` into `ProjectManagerPanel` so `/projects/:id?tab=project-manager&workItemId=:workItemId` opens the PM tab and selected detail without landing on the default sessions tab.

---

### `packages/web/src/lib/i18n.ts` (config, transform)

**Analog:** `packages/web/src/lib/i18n.ts`

**Existing Copilot pending action keys** (Chinese lines 220-263, English lines 2248-2291):
```typescript
"copilot.pendingAction.projectCreate": "创建项目",
"copilot.pendingAction.modelProviderApply": "应用模型服务商",
"copilot.pendingActions": "待审批操作",
"copilot.approve": "批准",
"copilot.reject": "拒绝",

"copilot.pendingAction.projectCreate": "Project create",
"copilot.pendingAction.modelProviderApply": "Model provider apply",
"copilot.pendingActions": "Pending actions",
"copilot.approve": "Approve",
"copilot.reject": "Reject",
```

**Existing Project Manager keys** (Chinese lines 710-801, English lines 2738-2829):
```typescript
"projects.projectManager": "项目经理",
"projects.projectManagerAttachEvidence": "附加证据",
"projects.projectManagerEvidenceReferenceHint": "证据引用是指针。请勿粘贴原始终端转录、飞书正文、模型提供商载荷或密钥。",
"projects.projectManagerLedger": "台账",
"projects.projectManagerEventEvidenceAttached": "证据已附加",

"projects.projectManager": "Project Manager",
"projects.projectManagerAttachEvidence": "Attach evidence",
"projects.projectManagerEvidenceReferenceHint": "Evidence references are pointers. Do not paste raw terminal transcripts, Feishu message bodies, provider payloads, or secrets.",
"projects.projectManagerLedger": "Ledger",
"projects.projectManagerEventEvidenceAttached": "Evidence attached",
```

Add Phase 12 copy to all locale blocks. Required keys include PM action labels, `View in Project Manager`, `Trace`, `Review before approval`, terminal PM failure copy, missing trusted evidence copy, and empty trace marker copy.

---

## Test Pattern Assignments

### `packages/gateway/test/copilot-tools.test.ts` (test, request-response/transform)

**Analog:** `packages/gateway/test/copilot-tools.test.ts`

**Setup and registry pattern** (lines 1-54):
```typescript
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { createCopilotToolRegistry, executeCopilotTool } from "../src/services/copilot/tool-registry.js";
import { createCopilotReadTools } from "../src/services/copilot/read-tools.js";

beforeEach(() => {
  db = createTestDb();
  const users = new UserRepository(db);
  userId = users.create("copilot-tools@example.com", "hash").id;
  registry = createCopilotToolRegistry(createCopilotReadTools());
});
```

**Read-only PM tool coverage** (lines 110-158):
```typescript
const tools = [
  "openforge.get_project_goal",
  "openforge.list_project_work_items",
  "openforge.get_project_work_item",
  "openforge.get_project_development_ledger"
];
for (const name of tools) {
  const definition = registry.tools.get(name);
  assert.equal(definition?.risk, "read");
  assert.equal(definition?.requiresApproval, false);
}
```

**Prepare tool pending-action test pattern** (lines 1429-1453, 2016-2035):
```typescript
const result = await executeCopilotTool(
  registry,
  "openforge.propose_project_create",
  { name: "New Project", path: "/tmp/openforge-new-project", aiTool: "claude" },
  context(userId, run.id)
);

const actions = new CopilotRepository(db, userId).listPendingActions(run.id);
assert.equal(result.ok, true);
assert.equal(actions.length, 1);
assert.equal(actions[0]?.status, "pending");
assert.equal(actions[0]?.type, "openforge.propose_project_create");
assert.equal(new ProjectRepository(db, userId).list().length, 0);
```

Add tests for exactly three PM proposal tools and assert they create pending actions without mutating `ProjectManagerRepository`.

---

### `packages/gateway/test/copilot-routes.test.ts` (test, request-response/event-driven)

**Analog:** `packages/gateway/test/copilot-routes.test.ts`

**Route test setup** (lines 1-55):
```typescript
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { beforeEach, describe, it } from "node:test";
import { signJwt } from "../src/auth/jwt.js";
import { CopilotRepository } from "../src/db/repositories/copilot-repository.js";
import { createCopilotRoutes } from "../src/routes/copilot.js";
```

**Waiting-for-approval run coverage** (lines 1586-1613):
```typescript
modelEvents = [{
  type: "tool_call_requested",
  id: "tool-call-1",
  name: "openforge.propose_project_create",
  input: { name: "Copilot Draft Project", path: projectPath, aiTool: "claude" }
}];

const res = await makeRequest(app, "POST", "/api/v1/copilot/runs", {
  prompt: "Create a new Claude Code project",
  source: "copilot"
}, authHeaders());

assert.equal(res.body.data.run.status, "waiting_for_approval");
assert.equal(res.body.data.pendingActions[0].type, "openforge.propose_project_create");
assert.equal(new ProjectRepository(db, userId).list().length, 0);
```

**Approval success pattern** (lines 3254-3284):
```typescript
const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_create", {
  name: "Copilot Created Project",
  path: projectPath,
  aiTool: "claude",
  description: "Created through approval",
  techStack: "TypeScript"
});

const res = await makeRequest(
  app,
  "POST",
  `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`,
  undefined,
  authHeaders()
);

assert.equal(res.body.data.action.status, "approved");
assert.equal(res.body.data.action.result.executed, true);
```

**Generic restore-to-pending test that PM tests must override** (lines 2645-2671):
```typescript
it("restores a processing pending action when approval execution throws", async () => {
  const failureApp = express();
  failureApp.use("/api/v1/copilot", createCopilotRoutes({
    db,
    masterKey,
    pendingActionApprover: async () => {
      throw new Error("approval crashed");
    }
  }));
  const { runId, actionId } = createPendingAction(userId, "openforge.propose_adapter_refresh");
  const res = await makeRequest(failureApp, "POST", `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`, undefined, authHeaders());
  const action = new CopilotRepository(db, userId).getPendingAction(actionId);
  assert.equal(res.status, 500);
  assert.equal(action?.status, "pending");
  assert.equal(action?.result, null);
});
```

Add PM route tests proving PM execution failure is terminal `failed`, not restored to `pending`.

**Invalid stored payload pattern** (lines 4505-4525, 4850-4868):
```typescript
const { runId, actionId } = createPendingAction(userId, "openforge.propose_project_create", {
  name: "Invalid Project",
  path: path.join(tmpdir(), `openforge-invalid-project-${randomSuffix()}`),
  aiTool: "shell"
});

const res = await makeRequest(app, "POST", `/api/v1/copilot/runs/${runId}/pending-actions/${actionId}/approve`, undefined, authHeaders());
const action = new CopilotRepository(db, userId).getPendingAction(actionId);
assert.equal(res.status, 400);
assert.equal(res.body.details.code, "copilot_project_create_invalid");
assert.equal(action?.status, "pending");
```

For PM invalid stored payloads, keep parse/validation failures non-mutating. For actual PM execution failures after a valid PM action is claimed, assert terminal failed.

---

### `packages/gateway/test/project-manager-repository.test.ts` (test, CRUD/transaction)

**Analog:** `packages/gateway/test/project-manager-repository.test.ts`

**Tenant and transaction pattern** (lines 43-96):
```typescript
const ownerRepo = new ProjectManagerRepository(db, owner.id);
const otherRepo = new ProjectManagerRepository(db, other.id);

const item = ownerRepo.createWorkItem(projectId, {
  title: "Implement repository",
  acceptanceCriteria: ["ledger event recorded"]
});

assert.equal(ownerRepo.getWorkItem(projectId, item.id)?.id, item.id);
assert.equal(otherRepo.getWorkItem(projectId, item.id), undefined);
assert.equal(ownerRepo.listLedgerEvents(projectId).length, 2);
assert.deepEqual(otherRepo.listLedgerEvents(projectId), []);
```

**Done and redaction tests to extend** (lines 115-153, 155-200):
```typescript
assert.throws(
  () => repo.updateWorkItemStatus(projectId, item.id, { status: "done" }),
  /evidence|manual completion/i
);

const stored = JSON.stringify({
  item: repo.getWorkItem(projectId, item.id),
  events: repo.listLedgerEvents(projectId, { workItemId: item.id }),
  audit: new AuditLogRepository(db, owner.id).list({ resourceType: "project_manager_work_item", resourceId: item.id })
});

assert.doesNotMatch(stored, /provider-secret|secret-signature/u);
assert.match(stored, /\[REDACTED\]/u);
```

Add cases for `pendingActionId` preservation, safe ledger trace details, and failed transaction rollback.

---

### `packages/gateway/test/project-manager-routes.test.ts` (test, request-response/CRUD)

**Analog:** `packages/gateway/test/project-manager-routes.test.ts`

**Envelope and route coverage** (lines 57-91):
```typescript
const evidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${itemId}/evidence`, {
  evidenceRefs: [{ kind: "test", label: "route suite", status: "passed", ref: "test/project-manager-routes.test.ts" }]
});
const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?limit=10`);

for (const response of [goalUpsert, goalRead, created, listed, detail, status, evidence, ledger]) {
  assert.equal(response.status, response === created ? 201 : 200);
  assert.equal(response.body.code, 0);
  assert.equal(response.body.message, "");
  assert.equal(typeof response.body.data, "object");
}
```

**Strict schema and no-write invalid-input pattern** (lines 109-149):
```typescript
const invalidEvidence = await request("POST", `/api/v1/projects/${projectId}/project-manager/work-items/${item.id}/evidence`, {
  evidenceRefs: [{ kind: "test", unexpected: "field" }]
});
const invalidEventType = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger?eventType=raw_terminal_output`);

for (const response of [invalidStatus, invalidEvidence, overLimit, invalidEventType, rawDetails]) {
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 1);
}
assert.equal(repo.listLedgerEvents(projectId, { workItemId: item.id }).length, beforeEvents);
```

**Raw details omitted from response** (lines 201-227):
```typescript
const item = await request("GET", `/api/v1/projects/${projectId}/project-manager/work-items/${created.id}`);
const ledger = await request("GET", `/api/v1/projects/${projectId}/project-manager/ledger`);
const serialized = JSON.stringify({ item: item.body, ledger: ledger.body });

assert.equal(serialized.includes("details"), false);
assert.doesNotMatch(serialized, /route-attach-secret|route\.jwt\.secret/u);
```

Add route tests for evidence refs with `pendingActionId` and ledger `trace` DTO while keeping raw `details` absent.

---

### `packages/web/src/lib/api.test.ts` (test, request-response/transform)

**Analog:** `packages/web/src/lib/api.test.ts`

**PM API client route expectations** (lines 957-1072):
```typescript
await projectManagerApi.createProjectManagerWorkItem("project/1", {
  title: "Expose tab",
  description: "Add a project detail surface",
  status: "todo",
  priority: 10,
  acceptanceCriteria: ["Tab is visible"],
  evidenceRefs: [{ kind: "test", label: "API test", ref: "api.test.ts", path: "packages/web/src/lib/api.test.ts" }],
  feishuRefs: [{ kind: "message", label: "Approval", ref: "om_123", feishuMessageId: "om_msg_123" }],
});

expect(fetch).toHaveBeenNthCalledWith(
  7,
  "http://127.0.0.1:48731/api/v1/projects/project%2F1/project-manager/work-items/work%2Fitem-1/evidence",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({
      evidenceRefs: [{ kind: "report", label: "Phase 11 evidence", ref: "PMEV-01", path: "docs/reports/phase-11-evidence.md" }],
    }),
  })
);
```

Add DTO-level compile/runtime expectations for `pendingActionId` evidence refs and ledger `trace` fields.

---

### `packages/web/src/lib/copilot.test.ts` (test, transform)

**Analog:** `packages/web/src/lib/copilot.test.ts`

**Label tests** (lines 63-120):
```typescript
expect(getCopilotPendingActionLabel("openforge.propose_project_create")).toBe("Project create");
expect(getCopilotPendingActionLabelKey("openforge.propose_project_create")).toBe("copilot.pendingAction.projectCreate");
expect(getCopilotPendingActionLabel("custom.pending_action")).toBe("Custom pending action");
```

**Pending summary tests** (lines 408-431):
```typescript
expect(
  getCopilotPendingActionSummary({
    type: "openforge.propose_project_config_sync",
    input: {
      projectId: "project-123",
      credentialMode: "stored_encrypted_key",
      templateId: "template-claude",
      decisions: { ".claude/settings.json": "overwrite" },
    },
  })
).toEqual({
  detail: "project-123 / stored_encrypted_key",
  preview: "template-claude / 1 file decision",
});
```

**Approved result tests** (lines 698-760):
```typescript
expect(
  getCopilotEventResultSummary({
    type: "pending_action_approved",
    payload: {
      actionType: "openforge.propose_project_create",
      result: {
        project: { id: "project-123", name: "Aether Glass", path: "/data/aether-glass", aiTool: "claude" },
        executed: true,
      },
    },
  })
).toEqual({
  detail: "Aether Glass / claude / created",
  preview: "/data/aether-glass",
});
```

Add PM action label, summary, result summary, failed-action copy, and no raw JSON fallback cases.

---

### `packages/web/e2e/copilot.spec.ts` (test, event-driven/request-response)

**Analog:** `packages/web/e2e/copilot.spec.ts`

**Authenticated E2E bootstrap** (lines 1-14):
```typescript
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
```

**Pending action mock and assertion pattern** (lines 528-657):
```typescript
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

await expect(assistantBubble.getByText("Pending actions")).toBeVisible();
await expect(assistantBubble.getByText("Session create")).toBeVisible();
await expect(assistantBubble.getByText("claude / project-1")).toBeVisible();
await expect(assistantBubble.getByRole("button", { name: "Approve" })).toBeVisible();
```

Use this for PM approval card E2E. Assert fixed PM fields, risk cue, trace chain, missing trusted evidence disabled approve, and approved result anchor.

**Failed continuation after approval pattern** (lines 1277-1307):
```typescript
onDecideAction: async (route) => {
  await route.fulfill({
    json: envelope({
      action: { id: "action-1", runId: "run-1", type: "openforge.propose_session_input", status: "approved" },
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
};
```

Copy this style for terminal PM failure UI, but assert the PM-specific copy and no retry button for the same action.

---

### `packages/web/e2e/project-manager.spec.ts` (test, CRUD/request-response)

**Analog:** `packages/web/e2e/project-manager.spec.ts`

**PM tab navigation and strict route mocks** (lines 18-31, 64-78):
```typescript
await page.goto(`/projects/${PROJECT_ID}`);
await page.getByRole("tab", { name: "Project Manager" }).click();

const panel = page.getByTestId("project-manager-panel");
await expect(panel).toBeVisible();
await expect(panel.getByRole("heading", { name: "Project Manager" })).toBeVisible();
await expect(panel.getByRole("row", { name: /Expose Project Manager tab/ })).toBeVisible();
```

**Evidence detail flow** (lines 126-147):
```typescript
await panel.getByRole("button", { name: "View details" }).click();
const sheet = page.getByRole("dialog", { name: "Review external evidence" });
await sheet.getByLabel("Kind").fill("report");
await sheet.getByLabel("Label").fill("Phase 11 evidence");
await sheet.getByLabel("Reference").fill("PMEV-01");
await sheet.getByLabel("Path").fill("docs/reports/phase-11-evidence.md");
await sheet.getByRole("button", { name: "Attach evidence" }).click();

await expect(sheet.getByText("PMEV-01")).toBeVisible();
await expect(sheet.getByText("docs/reports/phase-11-evidence.md")).toBeVisible();
```

**Ledger assertion pattern** (lines 177-209, 212-245):
```typescript
const ledger = panel.getByTestId("project-manager-ledger");
await expect(ledger.getByText("Evidence attached").first()).toBeVisible();
await expect(ledger.getByText("Work item status changed").first()).toBeVisible();
await expect(ledger.getByText("Review external evidence").first()).toBeVisible();

await expect(ledger.getByRole("button", { name: "All" })).toBeVisible();
await expect(ledger.getByRole("button", { name: "Status changes" })).toBeVisible();
await expect(ledger.getByRole("button", { name: "Evidence" })).toBeVisible();
```

**Mock route mutation pattern** (lines 488-617, 620-655):
```typescript
if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/work-items` && method === "POST") {
  const body = JSON.parse(route.request().postData() ?? "{}");
  expect(body).toEqual({
    title: "Confirm trial packet",
    status: "blocked",
    evidenceRefs: [{ kind: "report", label: "Trial checklist", ref: "TRIAL-1", path: "docs/TRIAL-CHECKLIST.md" }],
    feishuRefs: [{ kind: "message", label: "Feishu approval", ref: "om_999", feishuMessageId: "om_msg_999" }],
  });
  workItems = [...workItems, createdWorkItem];
  await route.fulfill({ json: envelope({ workItem: createdWorkItem }) });
  return;
}

if (url.pathname === `/api/v1/projects/${PROJECT_ID}/project-manager/ledger` && method === "GET") {
  await route.fulfill({
    json: envelope({
      events: projectManagerLedgerEvents(ledgerLimit, evidenceAttachedEvent),
    }),
  });
  return;
}
```

Add URL deep-link E2E: `page.goto(/projects/${PROJECT_ID}?tab=project-manager&workItemId=work-item-2)` should open the PM tab and detail sheet or highlight target row.

---

## Shared Patterns

### Authentication And Envelopes
**Source:** `packages/gateway/src/routes/project-manager.ts` lines 70-79 and `packages/gateway/src/routes/copilot.ts` lines 699-713
**Apply to:** All Gateway route changes
```typescript
router.use(authenticate);
res.json({ code: 0, data: { goal: goal ? toGoalDto(goal) : null }, message: "" });
return res.status(409).json({
  code: 1,
  message: "Copilot run is not waiting for approval",
  details: { code: "copilot_run_not_approvable", status: target.run.status }
});
```

### Tenant Scoping
**Source:** `packages/gateway/src/routes/project-manager.ts` lines 74-79, `packages/gateway/src/db/repositories/project-manager-repository.ts` lines 332-338
**Apply to:** PM approval handlers, PM route DTOs, repository tests
```typescript
const userId = userIdFor(req);
const project = requireProject(db, userId, req.params.projectId);
if (!project) return sendProjectNotFound(res);
const row = this.db.prepare(`
  SELECT *
  FROM project_manager_work_items
  WHERE id = ? AND user_id = ? AND project_id = ?
`).get(workItemId, this.userId, projectId) as WorkItemRow | undefined;
```

### Pending Action Status Updates
**Source:** `packages/gateway/src/db/repositories/copilot-repository.ts` lines 547-610
**Apply to:** Copilot PM approval terminal failure handling
```typescript
createPendingAction(runId: string, input: CreatePendingActionInput): CopilotPendingAction {
  this.db.prepare(`
    INSERT INTO copilot_pending_actions (
      id, user_id, run_id, type, status, input_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, this.userId, runId, input.type, JSON.stringify(input.input ?? {}), now, now);
  return this.getPendingAction(id) as CopilotPendingAction;
}

updatePendingActionIfStatus(actionId: string, expectedStatus: string, input: UpdatePendingActionInput): CopilotPendingAction | undefined {
  const result = this.db.prepare(`
    UPDATE copilot_pending_actions
    SET status = ?, result_json = ?, approved_by = ?, approved_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND status = ?
  `).run(/* ... */);
  if (result.changes !== 1) return undefined;
  return this.getPendingAction(actionId);
}
```

### Redaction Boundary
**Source:** `packages/gateway/src/db/repositories/project-manager-repository.ts` lines 195-201, 628-639 and `packages/gateway/src/services/copilot/read-tools.ts` lines 2378-2383
**Apply to:** PM action input schemas, evidence refs, ledger trace details, result summaries
```typescript
const sensitiveKeyPattern = /(secret|token|password|credential|authorization|api[_-]?key|private[_-]?key|signature|encrypt[_-]?key|std(?:err|out)|raw|terminal)/iu;

function normalizeEvidenceString(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length > maxStringLength) throw new Error("Evidence reference values must be 512 characters or fewer");
  const redacted = redactSensitiveString(normalized);
  return rawDetailTextPattern.test(redacted) ? "[REDACTED]" : redacted;
}
```

### UI Copy And Density
**Source:** `packages/web/src/components/copilot/copilot-chat-panel.tsx` lines 901-935 and `packages/web/src/components/projects/ProjectManagerPanel.tsx` lines 1360-1407
**Apply to:** PM pending-action cards, trace marker groups, ledger markers
```tsx
<div className="space-y-3 rounded-md border border-border bg-background/70 p-3">
  <div className="text-sm font-medium text-foreground">{label}</div>
  <div className="mt-1 break-words text-xs text-muted-foreground">{summary.detail}</div>
</div>

<div className="rounded-md border border-border/50 bg-background/40 px-2 py-2">
  <div className="text-xs text-muted-foreground">{label}</div>
  <div className="mt-1 break-all font-mono text-xs tabular-nums">{value}</div>
</div>
```

### URL State
**Source:** `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` lines 85-92, 859-928
**Apply to:** `View in Project Manager` anchor and PM tab initialization
```typescript
const searchParams = useSearchParams();
const [activeTab, setActiveTab] = useState("sessions");

<Tabs value={activeTab} onValueChange={setActiveTab}>
  <TabsTrigger value="project-manager">{t("projects.projectManager")}</TabsTrigger>
  <TabsContent value="project-manager" className="mt-4">
    <ProjectManagerPanel projectId={id} enabled={activeTab === "project-manager"} />
  </TabsContent>
</Tabs>
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/gateway/src/routes/copilot.ts` PM terminal-failure branch | route/controller | request-response, event-driven | Existing approval errors restore `processing` to `pending`; Phase 12 requires PM execution failure to become terminal `failed`. Use `CopilotRepository.updatePendingActionIfStatus` but do not copy the generic restore branch. |
| `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` + `ProjectManagerPanel` work-item deep link | route/component | URL state | Project detail reads `searchParams` only for `configStatus`; no existing tab/work item deep-link contract opens Project Manager detail from URL. |

## Metadata

**Analog search scope:** `packages/gateway/src/routes`, `packages/gateway/src/services/copilot`, `packages/gateway/src/db/repositories`, `packages/web/src/components`, `packages/web/src/lib`, `packages/web/src/app`, `packages/gateway/test`, `packages/web/e2e`
**Files scanned:** 266
**Primary analog count:** 18 candidate target files plus `copilot-repository.ts` support pattern
**Pattern extraction date:** 2026-05-22
