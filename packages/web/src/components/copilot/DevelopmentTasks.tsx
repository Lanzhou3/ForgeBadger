"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/hooks/use-language";
import { listProjects } from "@/lib/api";
import { getPlatformAction, type PlatformIntent, type PlatformReceipt } from "@/lib/platform-actions-api";
import { executeDevelopmentAction, getDevelopmentCapability, getDevelopmentTask, isDevelopmentActive, listDevelopmentTasks, previewDevelopmentAction, type DevelopmentEvidence, type DevelopmentStatus, type DevelopmentTask } from "@/lib/development-api";

function useCopy() {
  const { language } = useLanguage();
  return (zh: string, en: string) => language === "zh-CN" ? zh : en;
}
/** Map raw sandbox capability reasons to actionable host explanations; unknown codes fall back to the raw value. */
function sandboxReasonText(reason: string, copy: (zh: string, en: string) => string): string {
  switch (reason) {
    case "DEVELOPMENT_SANDBOX_REQUIRES_MACOS":
      return copy(
        "开发任务的检查需在 macOS Seatbelt 沙箱（/usr/bin/sandbox-exec）内隔离执行，当前主机不是 macOS，因此无法执行新开发任务。历史任务的差异与检查回执仍可查看，排队中的任务仍可取消。",
        "Development task checks must run isolated inside the macOS Seatbelt sandbox (/usr/bin/sandbox-exec). This host is not macOS, so new development tasks cannot run. Existing task diffs and check receipts remain viewable, and queued tasks can still be cancelled.",
      );
    case "DEVELOPMENT_SANDBOX_REQUIRES_NODE_22_8":
      return copy(
        "执行开发任务检查需要 Node 22.8 或更高版本，当前 Gateway 的 Node 版本不满足，因此无法执行新开发任务。",
        "Running development task checks requires Node 22.8 or newer. The Gateway is running an older Node version, so new development tasks cannot run.",
      );
    case "DEVELOPMENT_SANDBOX_UNAVAILABLE":
      return copy(
        "本机沙箱探测失败（/usr/bin/sandbox-exec 缺失或运行失败），因此无法执行新开发任务。",
        "The local sandbox probe failed (/usr/bin/sandbox-exec is missing or failed), so new development tasks cannot run.",
      );
    default:
      return "";
  }
}
function TaskStatus({ status }: { status: DevelopmentStatus }) {
  const copy = useCopy();
  const labels: Record<DevelopmentStatus, string> = {
    queued: copy("排队中", "Queued"), running: copy("运行中", "Running"),
    checks_passed: copy("检查通过 · 待验收", "Checks passed · review required"), checks_failed: copy("检查未通过", "Checks failed"),
    failed: copy("失败", "Failed"), cancelled: copy("已取消", "Cancelled"), indeterminate: copy("结果未知 · 需核实", "Indeterminate · verify manually"), accepted: copy("所有者已验收", "Accepted by owner"),
  };
  return <Badge variant="outline">{labels[status] ?? status}</Badge>;
}
function QueryError({ error, retry }: { error: Error; retry: () => void }) {
  const copy = useCopy();
  return <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error.message}</p><Button variant="outline" size="sm" onClick={retry}>{copy("重试读取", "Retry read")}</Button></div>;
}

export function DevelopmentTasks({initialProjectId = "", initialTaskId = ""}: {initialProjectId?: string; initialTaskId?: string} = {}) {
  const copy = useCopy();
  const [projectId, setProjectId] = useState(initialProjectId);
  const [taskId, setTaskId] = useState(initialTaskId);
  const projects = useQuery({ queryKey: ["development-projects"], queryFn: listProjects });
  const capability = useQuery({ queryKey: ["development-capability"], queryFn: getDevelopmentCapability });
  const tasks = useQuery({
    queryKey: ["development-tasks", projectId], queryFn: () => listDevelopmentTasks(projectId), enabled: Boolean(projectId),
    refetchInterval: query => query.state.data?.tasks.some(task => isDevelopmentActive(task.status)) ? 5000 : false,
  });
  return <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3 pl-12 md:pl-0"><h1 className="text-lg font-semibold">{copy("受控开发任务", "Controlled development tasks")}</h1><Link href="/copilot" className="text-sm text-brand hover:underline">{copy("返回 Copilot", "Back to Copilot")}</Link></header>
    <p className="text-sm text-muted-foreground">{copy("查看隔离任务的差异和检查回执。检查通过后仍需所有者判断目标是否完成；验收不会合并或写回源项目。", "Review isolated task diffs and check receipts. Passing checks still requires the owner's judgment of the goal. Acceptance does not merge or write back to the source project.")}</p>
    {capability.isPending && <p role="status">{copy("正在检查运行能力…", "Checking runtime capability…")}</p>}
    {capability.isError && <QueryError error={capability.error} retry={() => void capability.refetch()} />}
    {capability.data && !capability.data.available && <p role="status" className="rounded-lg border border-border p-3 text-sm">{sandboxReasonText(capability.data.reason ?? "", copy) || `${copy("当前无法执行新开发任务：", "New development tasks are unavailable: ")}${capability.data.reason ?? copy("运行环境不可用", "Runtime unavailable")}`}</p>}
    {projects.isPending ? <p role="status">{copy("正在加载项目…", "Loading projects…")}</p> : projects.isError ? <QueryError error={projects.error} retry={() => void projects.refetch()} /> : !projects.data.projects.length ? <p>{copy("暂无项目。请先导入项目。", "No projects. Import a project first.")}</p> : <label className="flex flex-wrap items-center gap-3 text-sm">{copy("项目", "Project")}<select aria-label={copy("项目", "Project")} className="max-w-full rounded-md border border-border bg-background px-3 py-2" value={projectId} onChange={event => { setProjectId(event.target.value); setTaskId(""); }}><option value="">{copy("选择项目", "Select a project")}</option>{projects.data.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
    {projectId && <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,3fr)]">
      <section className="min-w-0 space-y-3 rounded-lg border border-border p-3" aria-label={copy("任务列表", "Task list")}>
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{copy("任务", "Tasks")}</h2><Button variant="ghost" size="sm" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>{copy("刷新", "Refresh")}</Button></div>
        {tasks.isPending && <p role="status">{copy("正在加载任务…", "Loading tasks…")}</p>}
        {tasks.isError && <QueryError error={tasks.error} retry={() => void tasks.refetch()} />}
        {!tasks.isError && tasks.data?.tasks.length === 0 && <p className="text-sm text-muted-foreground">{copy("暂无任务。在 Copilot 对话中提出开发目标，审阅任务预览并确认后创建。", "No tasks. Describe your development goal in Copilot, review the task preview and confirm to create it.")}</p>}
        {tasks.data?.tasks.map(task => <button key={task.id} type="button" aria-pressed={task.id === taskId} className="w-full space-y-2 rounded-md border border-border/70 p-3 text-left text-sm hover:bg-muted aria-pressed:bg-muted" onClick={() => setTaskId(task.id)}><span className="block break-words">{task.goal}</span><TaskStatus status={task.status} /></button>)}
      </section>
      {taskId ? <TaskDetails key={`${projectId}:${taskId}`} projectId={projectId} taskId={taskId} /> : <p className="p-3 text-sm text-muted-foreground">{copy("选择任务查看差异和回执。", "Select a task to review its diff and receipts.")}</p>}
    </div>}
  </div>;
}

function TaskDetails({ projectId, taskId }: { projectId: string; taskId: string }) {
  const copy = useCopy();
  const detail = useQuery({ queryKey: ["development-task", projectId, taskId], queryFn: () => getDevelopmentTask(projectId, taskId), refetchInterval: query => query.state.data && isDevelopmentActive(query.state.data.task.status) ? 5000 : false });
  if (detail.isPending) return <p role="status">{copy("正在加载回执…", "Loading evidence…")}</p>;
  if (detail.isError) return <QueryError error={detail.error} retry={() => void detail.refetch()} />;
  const { task, evidence } = detail.data;
  return <section className="min-w-0 space-y-4 rounded-lg border border-border p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="break-words text-sm font-semibold">{task.goal}</h2><div className="flex items-center gap-2"><TaskStatus status={task.status} /><Button variant="ghost" size="sm" disabled={detail.isFetching} onClick={() => void detail.refetch()}>{copy("刷新回执", "Refresh evidence")}</Button></div></div>
    <p className="break-all text-xs text-muted-foreground">{task.id} · {copy("版本", "Revision")} {task.revision} · {new Date(task.updatedAt).toLocaleString()}</p>
    {task.error && <p role="alert" className="break-words text-sm text-destructive">{sandboxReasonText(task.error, copy) ? <>{sandboxReasonText(task.error, copy)}<span className="mt-1 block font-mono text-xs opacity-70">{task.error}</span></> : task.error}</p>}
    {task.status === "indeterminate" && <p role="status">{copy("执行结果未知，请人工核实已有回执；不要重复执行。", "Execution outcome is unknown. Verify existing receipts manually; do not replay.")}</p>}
    {evidence ? <EvidencePanel evidence={evidence} /> : <p className="text-sm text-muted-foreground">{copy("尚无可用差异或检查回执。", "No diff or check evidence is available yet.")}</p>}
    <TaskAction key={task.id} task={task} />
  </section>;
}
function EvidencePanel({ evidence }: { evidence: DevelopmentEvidence }) {
  const copy = useCopy();
  return <div className="min-w-0 space-y-4">
    <details className="rounded-md border border-border/70 p-3"><summary className="cursor-pointer text-sm">{copy("产物与输入摘要", "Artifact and input digests")}</summary><dl className="space-y-2 break-all pt-2 font-mono text-xs"><dt>sourceDigest</dt><dd>{evidence.sourceDigest}</dd><dt>outputDigest</dt><dd>{evidence.outputDigest}</dd><dt>recipeDigest</dt><dd>{evidence.recipeDigest}</dd></dl></details>
    <div><h3 className="mb-2 text-sm font-semibold">{copy("文件差异", "File changes")}</h3>{evidence.files.length ? <ul className="space-y-1 break-all text-xs">{evidence.files.map(file => <li key={file.path}><details><summary className="cursor-pointer">{file.path}</summary><p>{file.beforeSha256 ?? "∅"} → {file.afterSha256 ?? "∅"}</p></details></li>)}</ul> : <p className="text-sm text-muted-foreground">{copy("没有文件变更。", "No file changes.")}</p>}<pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{evidence.diff || copy("无差异内容", "No diff content")}</pre></div>
    <div className="space-y-2"><h3 className="text-sm font-semibold">{copy("检查回执", "Check receipts")}</h3>{!evidence.checks.length && <p className="text-sm text-muted-foreground">{copy("未运行检查。", "No checks were run.")}</p>}{evidence.checks.map((check, index) => <details key={`${check.path}:${index}`} className="rounded-md border border-border/70 p-3"><summary className="cursor-pointer break-all text-sm">{check.path} · {copy("退出码", "Exit code")} {check.exitCode ?? "—"} · {check.durationMs} ms{check.timedOut ? copy(" · 超时", " · Timed out") : ""}{check.cancelled ? copy(" · 已取消", " · Cancelled") : ""}</summary><p className="mt-2 text-xs">stdout</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{check.stdout || "—"}</pre><p className="mt-2 text-xs">stderr</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{check.stderr || "—"}</pre></details>)}</div>
  </div>;
}

function TaskAction({ task }: { task: DevelopmentTask }) {
  const copy = useCopy();
  const client = useQueryClient();
  const [intent, setIntent] = useState<PlatformIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [receipt, setReceipt] = useState<PlatformReceipt | null>(null);
  const [now, setNow] = useState(Date.now());
  const requestKey = useRef<string | null>(null);
  const previewRevision = useRef(task.revision);
  const submitting = useRef(false);
  const action = task.status === "checks_passed" && task.artifactDigest ? "accept" : isDevelopmentActive(task.status) ? "cancel" : null;
  useEffect(() => {
    if (previewRevision.current !== task.revision && !attempted) { setIntent(null); requestKey.current = null; }
    previewRevision.current = task.revision;
  }, [task.revision, attempted]);
  useEffect(() => { if (!intent) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [intent]);
  async function preview() {
    if (!action || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    requestKey.current ??= crypto.randomUUID();
    try { const result = await previewDevelopmentAction(task, action, requestKey.current); setNow(Date.now()); setIntent(result.intent); }
    catch (err) { setError(err instanceof Error ? err.message : copy("预览失败", "Preview failed")); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!intent || attempted || submitting.current || intent.expires_at <= Date.now()) return;
    submitting.current = true; setBusy(true); setError(""); setAttempted(true);
    try {
      const current = await getPlatformAction(intent.id);
      if (current.receipt) { setReceipt(current.receipt); return; }
      if (current.intent.digest !== intent.digest || current.intent.status !== "approved" || current.intent.authority !== "owner_action" || current.intent.expires_at <= Date.now()) throw new Error(copy("预览已失效，请刷新任务并重新核实。", "Preview is no longer valid. Refresh the task and review again."));
      setReceipt((await executeDevelopmentAction(intent.id)).receipt);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : copy("操作失败", "Action failed")} ${copy("请核实操作回执；不会自动重试执行。", "Verify the action receipt; execution will not be retried automatically.")}`);
    } finally {
      submitting.current = false; setBusy(false);
      void client.invalidateQueries({ queryKey: ["development-tasks", task.projectId] });
      void client.invalidateQueries({ queryKey: ["development-task", task.projectId, task.id] });
    }
  }
  async function readReceipt() {
    if (!intent) return;
    setBusy(true);
    try { const result = await getPlatformAction(intent.id); setReceipt(result.receipt); setError(result.receipt ? "" : copy("尚无回执，请人工核实。", "No receipt yet. Verify manually.")); }
    catch (err) { setError(err instanceof Error ? err.message : copy("读取失败", "Read failed")); }
    finally { setBusy(false); }
  }
  if (!action && !intent) return null;
  return <div className="space-y-3 border-t border-border pt-3">
    {!intent && <Button variant="outline" disabled={busy} onClick={() => void preview()}>{busy ? copy("正在生成预览…", "Preparing preview…") : action === "accept" ? copy("预览验收操作", "Preview acceptance") : copy("预览取消操作", "Preview cancellation")}</Button>}
    {intent && <div className="space-y-3 rounded-md border border-border/70 p-3"><h3 className="text-sm font-semibold">{copy("确认精确操作", "Confirm exact action")}</h3><p className="text-xs text-muted-foreground">{copy("本次人工确认。验收记录所有者判断，不会合并或写回源项目。", "One-time owner confirmation. Acceptance records the owner's judgment and does not merge or write back to the source project.")}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{intent.command_id}{"\n"}{intent.input_json}{"\n"}{intent.resources_json}</pre><p className="break-all text-xs">{intent.digest}</p><p className="text-xs">{copy("有效期", "Expires")} {new Date(intent.expires_at).toLocaleString()}</p>
      {intent.expires_at <= now && <p role="alert">{copy("预览已过期，请重新预览。", "Preview expired. Prepare a new preview.")}</p>}
      {!attempted && !busy && intent.expires_at <= now && <Button variant="outline" size="sm" onClick={() => { requestKey.current = null; setIntent(null); }}>{copy("重新预览", "New preview")}</Button>}
      {!attempted && <Button disabled={busy || intent.expires_at <= now || intent.authority !== "owner_action" || intent.status !== "approved"} onClick={() => void confirm()}>{busy ? copy("正在确认…", "Confirming…") : copy("所有者确认并执行", "Owner confirms and executes")}</Button>}
      {attempted && <Button size="sm" variant="outline" disabled={busy} onClick={() => void readReceipt()}>{copy("读取操作回执", "Read action receipt")}</Button>}
    </div>}
    {receipt && <p role="status">{receipt.outcome === "confirmed" ? copy("操作回执已确认。", "Action receipt confirmed.") : receipt.outcome === "unknown" ? copy("操作结果未知，请人工核实；不会自动重放。", "Action outcome unknown. Verify manually; no automatic replay.") : copy("确认未产生变更。", "Confirmed no effect.")}</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
  </div>;
}
