# Phase 03: First-User Product Hardening - Pattern Map

**Mapped:** 2026-05-20T10:05:00+08:00
**Files analyzed:** 12
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/web/src/app/(dashboard)/page.tsx` | page component | request-response query rendering | same file health card/query pattern | exact |
| `packages/web/src/app/(dashboard)/settings/page.tsx` | page component | request-response query rendering | same file Feishu degraded-state card | exact |
| `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` | page component | request-response mutation/query rendering | same file runtime adapter selector | exact |
| `packages/web/src/app/(dashboard)/sessions/[id]/page.tsx` | page component | request-response mutation/query rendering | same file connect fallback | exact |
| `packages/web/src/lib/terminal-runtime.ts` | utility | transform | same file translation-key switch | exact |
| `packages/web/src/lib/copilot.ts` | utility | transform/state merge | same file active-run helpers | exact |
| `packages/web/src/lib/copilot.test.ts` | unit test | transform/state assertion | same file active-run stale data tests | exact |
| `packages/web/src/components/copilot/copilot-chat-panel.tsx` | component | event-driven + request-response | same file poll/gateway-event state paths | exact |
| `packages/web/e2e/copilot.spec.ts` | E2E test | request interception | strict route fallback helper | exact |
| `packages/web/e2e/models.spec.ts` | E2E test | request interception | Copilot strict fallback helper | role-match |
| `docs/TRIAL-CHECKLIST.md` | docs | manual workflow checklist | same file evidence sections | exact |
| `docs/TRIAL-FEEDBACK.md` | docs | manual issue template | same file triage/evidence sections | exact |

## Pattern Assignments

### `packages/web/src/app/(dashboard)/page.tsx` (page component, request-response query rendering)

**Analog:** same file health card pattern.

**Query + derived state pattern** (lines 43-64):
```typescript
const dependenciesQuery = useQuery({
  queryKey: ["dependencies"],
  queryFn: getDependencies,
});
const terminalRuntime = dependenciesQuery.data?.terminalRuntime;
```

**Health card pattern** (lines 113-118):
```typescript
{
  label: t("dashboard.dependenciesHealth"),
  detail: t(terminalRuntimeTranslationKey(terminalRuntime?.mode)),
  healthy: terminalRuntime?.supported ?? !dependenciesQuery.isError,
  icon: CheckCircle2,
  href: "/settings",
}
```

**Planner note:** Phase 3 should correct false-green fallback behavior here if dependency data is absent or the query errors.

---

### `packages/web/src/app/(dashboard)/settings/page.tsx` (page component, request-response query rendering)

**Analog:** same file query-card degraded state.

**Query pattern** (lines 49-64):
```typescript
const { data: adapterData, isLoading: adaptersLoading } = useQuery({
  queryKey: ["adapter-discovery"],
  queryFn: discoverAdapters,
});
const { data: auditData, isLoading: auditLoading } = useQuery({
  queryKey: ["audit-logs", "settings"],
  queryFn: () => listAuditLogs({ limit: 8 }),
});
```

**Existing degraded-state pattern to copy** (lines 207-218):
```typescript
{feishuStatusLoading ? (
  <p className="text-sm text-muted-foreground">
    {t("settings.feishuStatusLoading")}
  </p>
) : feishuStatusError ? (
  <p className="text-sm text-muted-foreground">
    {t("settings.feishuStatusLoadFailed")}
  </p>
) : feishuStatus ? (
  <FeishuIntegrationItem status={feishuStatus} />
) : null}
```

**Planner note:** Apply the same explicit error branch to adapter discovery and audit/diagnostics-adjacent panels where currently missing.

---

### `packages/web/src/app/(dashboard)/projects/[id]/page.tsx` (page component, request-response mutation/query rendering)

**Analog:** same file runtime adapter launch readiness pattern.

**Adapter query + launchability pattern** (lines 159-162, 310-327):
```typescript
const { data: adapterDiscoveryData, isLoading: adapterDiscoveryLoading } = useQuery({
  queryKey: ["adapters", "discovery"],
  queryFn: discoverAdapters,
});
const runtimeAdapters = adapterDiscoveryData?.adapters ?? [];
const launchableRuntimeAdapters = useMemo(
  () => runtimeAdapters.filter(isAdapterLaunchable),
  [runtimeAdapters]
);
```

**Runtime selector and no-launchable message pattern** (lines 527-564):
```typescript
<select
  id="runtime-adapter"
  value={selectedRuntimeAdapter}
  onChange={(event) => setSelectedRuntimeAdapter(event.target.value as RuntimeAdapterId)}
  disabled={adapterDiscoveryLoading || runtimeAdapters.length === 0}
>
  {runtimeAdapters.map((adapter) => (
    <option key={adapter.id} value={adapter.id} disabled={!isAdapterLaunchable(adapter)}>
      {adapter.label}
    </option>
  ))}
</select>
{launchableRuntimeAdapters.length === 0 && !adapterDiscoveryLoading ? (
  <p className="flex items-center gap-1 text-xs text-destructive">
    <AlertTriangle className="size-3.5" />
    {t("projects.noLaunchableRuntimeCli")}
  </p>
) : (
  <p className="text-xs text-muted-foreground">
    {t("projects.runtimeCliDescription")}
  </p>
)}
```

**Planner note:** Keep source of truth in adapter discovery and make the failure message actionable instead of adding frontend-only availability checks.

---

### `packages/web/src/app/(dashboard)/sessions/[id]/page.tsx` (page component, request-response mutation/query rendering)

**Analog:** same file connect/preparing fallback.

**Auto-connect guard pattern** (lines 78-100):
```typescript
if (!shouldAutoConnectSession({
  sessionId: id,
  hasAuthToken: authToken.length > 0,
  hasAttachTokenOverride: attachTokenOverride !== null,
  isConnecting,
  hasConnectedSession: Boolean(connectedSession),
  hasConnectError: connectMutation.isError,
})) {
  return;
}
connectSessionMutation();
```

**Visible terminal-open failure pattern** (lines 132-151):
```typescript
if (missing.length > 0 || connectMutation.isError) {
  const errorMessage =
    connectMutation.error instanceof Error
      ? connectMutation.error.message
      : `Missing ${missing.join(" and ")}`;
  return (
    <div className="max-w-md rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
      <h2 className="text-lg font-semibold text-destructive">{t("sessions.cannotOpen")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {errorMessage}. {t("sessions.returnToList")}
      </p>
    </div>
  );
}
```

**Planner note:** Reuse this pattern for session recovery guidance; do not reintroduce endless preparing state after a connect error.

---

### `packages/web/src/lib/terminal-runtime.ts` (utility, transform)

**Analog:** same file switch.

**Translation-key transform pattern** (lines 3-13):
```typescript
export function terminalRuntimeTranslationKey(mode: string | undefined): TranslationKey {
  switch (mode) {
    case "native_tmux":
      return "dashboard.terminalRuntime.native";
    case "wsl_required":
      return "dashboard.terminalRuntime.wslRequired";
    case "tmux_missing":
      return "dashboard.terminalRuntime.tmuxMissing";
    default:
      return "dashboard.dependenciesHealthDescription";
  }
}
```

**Planner note:** Add helper functions here if Phase 3 needs action labels, severity, or route targets for runtime modes.

---

### `packages/web/src/lib/copilot.ts` (utility, transform/state merge)

**Analog:** same file active-run helpers.

**Live-state and monotonic guard pattern** (lines 597-628):
```typescript
export function isCopilotRunLive(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_for_approval";
}

export function shouldKeepCopilotActiveRunState(
  current: CopilotActiveRunSnapshot | null,
  next: CopilotActiveRunSnapshot
): boolean {
  if (!current || current.run.id !== next.run.id) return false;
  const currentUpdatedAt = current.run.updatedAt ?? current.run.createdAt ?? 0;
  const nextUpdatedAt = next.run.updatedAt ?? next.run.createdAt ?? 0;
  if (currentUpdatedAt > nextUpdatedAt) return true;
  if (currentUpdatedAt < nextUpdatedAt) return false;
  if (maxSequence(current.events) > maxSequence(next.events)) return true;
  if (maxUpdatedAt(current.pendingActions) > maxUpdatedAt(next.pendingActions)) return true;
  return isTerminalCopilotRunStatus(current.run.status) && !isTerminalCopilotRunStatus(next.run.status);
}
```

**Test analog** (`packages/web/src/lib/copilot.test.ts` lines 1229-1268):
```typescript
it("keeps a newer active run state over stale poll data", () => {
  expect(shouldKeepCopilotActiveRunState(current, staleNext)).toBe(true);
  expect(shouldKeepCopilotActiveRunState(current, newerCompleted)).toBe(false);
});
```

**Planner note:** Put new request-order or stale-response helpers here and test them in `copilot.test.ts`.

---

### `packages/web/src/components/copilot/copilot-chat-panel.tsx` (component, event-driven + request-response)

**Analog:** same file polling and gateway-event paths.

**Visibility-aware polling pattern** (lines 373-439):
```typescript
if (!activeRun?.run.id || !isCopilotRunLive(activeRun.run.status)) return;
let stopped = false;
let pollAttempt = 0;
const schedulePoll = () => {
  clearTimer();
  if (stopped || document.visibilityState === "hidden") return;
  timer = setTimeout(pollRun, getCopilotRunPollDelayMs(pollAttempt));
};
```

**Gateway event refresh pattern** (lines 441-523):
```typescript
const onGatewayEvent = async (event: Event) => {
  const detail = (event as CustomEvent<GatewayEvent>).detail;
  const currentActiveRunId = activeRunIdRef.current;
  if (!shouldRefreshCopilotPanelForGatewayEvent({
    event: detail ?? {},
    activeRunId: currentActiveRunId,
    selectedConversationId: currentSelectedConversationId,
  })) {
    return;
  }
  const data = await getCopilotRun(runId);
  if (stopped) return;
  applyActiveRunState({
    run: data.run,
    events: data.events,
    pendingActions: data.pendingActions,
  });
};
```

**Planner note:** Every active-run assignment should continue to flow through `applyActiveRunState()` unless intentionally clearing state on conversation change.

---

### `packages/web/e2e/copilot.spec.ts` (E2E test, request interception)

**Analog:** strict route fallback helper.

**Route mock structure** (lines 1351-1378):
```typescript
await page.route("**/api/v1/**", async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  if (url.pathname === "/api/v1/auth/me") {
    await route.fulfill({ json: envelope({ id: "user-e2e" }) });
    return;
  }
});
```

**Strict fallback pattern** (lines 1609-1615):
```typescript
await route.fulfill({
  status: 404,
  json: {
    code: 1,
    message: `Unhandled mocked API route: ${method} ${url.pathname}`,
  },
});
```

**Planner note:** Copy this pattern into `models.spec.ts` and adjust hidden assumptions exposed by the stricter fallback.

---

### `packages/web/e2e/models.spec.ts` (E2E test, request interception)

**Analog:** current Models route mock, to harden using Copilot strict fallback.

**Current route mock and live gap** (lines 116-118, 284):
```typescript
await page.route("**/api/v1/**", async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  ...
  await route.fulfill({ json: envelope({}) });
});
```

**Credential mock pattern** (lines 218-229):
```typescript
configuredCredentials = [
  {
    id: "credential-1",
    providerProfileId: "provider-profile-1",
    label: "Minimax subscription",
    status: "active",
    secretPreview: "sk-...test",
  },
];
```

**Planner note:** Keep `secretPreview` as redacted response data if asserted, but avoid plaintext input values that look like live secrets.

---

### `docs/TRIAL-CHECKLIST.md` (docs, manual workflow checklist)

**Analog:** same file evidence checklist.

**Environment evidence pattern** (lines 8-25):
```markdown
- Node version: `node --version`
- tmux version: `tmux -V`
- Claude Code version: `claude --version`
- npm/CLI only: `openforge doctor` output:
```

**Manual boundary pattern** (lines 117-123):
```markdown
- [ ] I recorded any step that CI cannot prove: real browser terminal behavior,
      real Claude Code permission prompt behavior, physical Windows/WSL
      behavior, and local diagnostics review.
- [ ] I did not paste API keys, passwords, JWTs, attach tokens, private keys,
      or unrelated project secrets into feedback.
```

**Planner note:** Add explicit mapping from checklist failures to `UX-01` through `UX-07`.

---

### `docs/TRIAL-FEEDBACK.md` (docs, manual issue template)

**Analog:** same file triage/evidence fields.

**Dependency command pattern** (lines 18-32):
```markdown
node --version
tmux -V
claude --version
openforge doctor
```

**Triage mapping pattern** (lines 72-77):
```markdown
- Category: dependency / provider / CLI / platform / Copilot / docs / other
- Severity: blocker / high / medium / low
- Mapped requirement: REL-* or UX-*
- Follow-up phase: Phase 1 evidence / Phase 3 hardening / later
```

**Planner note:** Make `Mapped requirement` concrete for Phase 3 by listing `UX-01` through `UX-07` options and requiring expected/actual behavior.

## Shared Patterns

### Query Error Handling
**Source:** `packages/web/src/app/(dashboard)/settings/page.tsx` lines 207-218
**Apply to:** Settings adapter discovery, audit logs, diagnostics-adjacent panels, partial Copilot failures.

### Runtime Source Of Truth
**Source:** `packages/gateway/src/lib/dependency-check.ts` lines 28-39 and `packages/web/src/lib/terminal-runtime.ts` lines 3-13
**Apply to:** Dashboard, Settings, project launch, session guidance.

### Copilot State Freshness
**Source:** `packages/web/src/lib/copilot.ts` lines 597-628
**Apply to:** all active-run updates from send success, polling, gateway events, approval decisions, and stale request handling.

### E2E Strict Fallback
**Source:** `packages/web/e2e/copilot.spec.ts` lines 1609-1615
**Apply to:** `packages/web/e2e/models.spec.ts` and any touched `/api/v1/*` route mock.

### Trial Evidence Caveats
**Source:** `docs/TRIAL-CHECKLIST.md` lines 117-123 and `docs/TRIAL-FEEDBACK.md` lines 57-58
**Apply to:** any Phase 3 docs updates involving manual evidence or diagnostics attachments.

## No Analog Found

None. All expected Phase 3 files have existing in-repo analogs.

## Metadata

**Analog search scope:** `packages/web/src`, `packages/web/e2e`, `packages/gateway/src/lib`, `docs`
**Files scanned:** 12 focused files plus GSD context/research
**Pattern extraction date:** 2026-05-20T10:05:00+08:00
