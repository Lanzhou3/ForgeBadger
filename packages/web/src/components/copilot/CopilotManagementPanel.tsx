"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createGrant,
  listGrants,
  revokeGrant,
  deleteGrant,
  getProjectOverview,
  updateProjectManagement,
  type ManagedProject,
} from "@/lib/platform-actions-api";

interface Props {
  onStartConversation: (grantId: string) => Promise<void>;
  boundGrantId?: string | null;
  startConversationLabel?: string;
  onGrantCreated?: (grantId:string)=>void;
}
const names: Record<string, string> = {
  "project.create": "创建项目",
  "project.metadata.update": "更新项目资料",
  "pm.work_item.create": "创建工作项",
  "pm.work_item.metadata": "更新工作项资料",
  "pm.management.update": "更新负责人及下一步",
  "pm.task.prepare": "准备任务",
  "session.start": "启动会话",
  "session.stop": "停止会话",
  "memory.write": "写入记忆",
};
export function CopilotManagementPanel({
  onStartConversation,
  boundGrantId,
  startConversationLabel = "以此授权新建会话",
  onGrantCreated,
}: Props) {
  const client = useQueryClient();
  const grants = useQuery({
    queryKey: ["copilot-grants"],
    queryFn: listGrants,
    refetchInterval: 15000,
  });
  const overview = useQuery({
    queryKey: ["project-management-overview"],
    queryFn: () => getProjectOverview(),
    refetchInterval: 30000,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const revokedCount = grants.data?.grants.filter(g => g.status === "revoked").length ?? 0;
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["copilot-grants"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 p-4 text-sm">
      <section className="space-y-3">
        <h2 className="font-semibold">项目与操作授权</h2>
        <p className="text-xs text-muted-foreground">
          授权仅用于新建的空会话；绑定后不可切换。撤销将停止后续操作，已发生的操作仍保留记录。
        </p>
        {boundGrantId && (
          <p className="break-all text-xs">
            当前会话绑定：
            {grants.data?.grants.find((g) => g.id === boundGrantId)?.name ??
              boundGrantId}
          </p>
        )}
        {grants.isPending && <p role="status">正在加载授权…</p>}
        {grants.isError && (
          <p role="alert">
            授权加载失败{" "}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void grants.refetch()}
            >
              重试
            </Button>
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {grants.data && (
          <>
            {!grants.data.grants.length && (
              <p className="text-muted-foreground">尚未创建授权。</p>
            )}
            {revokedCount > 0 && <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={() => setShowRevoked(!showRevoked)}>{showRevoked ? "收起" : "查看"}已撤销授权（{revokedCount}）</Button>
              {showRevoked && <p className="text-xs text-muted-foreground">删除后不再出现在列表中，历史会话和操作记录仍保留。</p>}
            </div>}
            {grants.data.grants.filter(g => showRevoked || g.status !== "revoked").map((grant) => {
              const expired = grant.expiresAt !== null && grant.expiresAt <= Date.now();
              const usable =
                grant.status === "active" &&
                !expired &&
                (grant.maxActions === null || grant.usedActions < grant.maxActions);
              return (
                <div
                  key={grant.id}
                  className="space-y-2 rounded-md border border-border/70 p-3"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>{grant.name}</strong>
                    <span>
                      {grant.status === "revoked"
                        ? "已撤销"
                        : expired
                          ? "已过期"
                          : "有效"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {grant.scope.projectIds
                      .map(
                        (id) =>
                          overview.data?.projects.find((p) => p.id === id)
                            ?.name ?? id,
                      )
                      .join("、") || "无现有项目"}{" "}
                    ·{" "}
                    {grant.scope.capabilities
                      .map((id) => names[id] ?? id)
                      .join("、")}
                  </p>
                  <p className="text-xs">
                    操作次数 {grant.usedActions}/{grant.maxActions ?? "不限"} · 最大并发{" "}
                    {grant.maxConcurrency} · 到期{" "}
                    {grant.expiresAt === null ? "长期有效，直至撤销" : new Date(grant.expiresAt).toLocaleString()}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !usable}
                      onClick={() =>
                        void perform(() => onStartConversation(grant.id))
                      }
                    >
                      {startConversationLabel}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || grant.status !== "active"}
                      onClick={() => void perform(() => revokeGrant(grant.id))}
                    >
                      撤销授权
                    </Button>
                    {grant.status === "revoked" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => deleteGrant(grant.id))}>删除授权</Button>}
                  </div>
                </div>
              );
            })}
            {overview.data && (
              <GrantForm
                projects={overview.data.projects}
                capabilities={grants.data.capabilities}
                busy={busy}
                onCreate={async input => {
                  const result=await createGrant(input);
                  await client.invalidateQueries({queryKey:["copilot-grants"]});
                  onGrantCreated?.(result.grant.id);
                }}
              />
            )}
          </>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">多项目进度</h2>
        <p className="text-xs text-muted-foreground">
          此处是账号下的项目管理视图，不会扩大会话授权范围。CLI
          模式用于任务规划；当前 CLI 自动执行权限未验证，仍需人工操作。
        </p>
        {overview.isPending && <p role="status">正在加载项目…</p>}
        {overview.isError && (
          <p role="alert">
            项目加载失败{" "}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void overview.refetch()}
            >
              重试
            </Button>
          </p>
        )}
        {overview.data?.projects.length === 0 && (
          <p className="text-muted-foreground">
            暂无项目，请先在项目页创建或导入。
          </p>
        )}
        {overview.data?.projects.map((project) => (
          <ManagementRow
            key={`${project.id}-${project.management.revision}`}
            project={project}
          />
        ))}
      </section>
    </div>
  );
}

function GrantForm({ projects, capabilities, busy, onCreate }: {
  projects: ManagedProject[];
  capabilities: { capability: string }[];
  busy: boolean;
  onCreate: (input: Parameters<typeof createGrant>[0]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [allOperations, setAllOperations] = useState(true);
  const [actions, setActions] = useState<string[]>([]);
  const [permanent, setPermanent] = useState(true);
  const [unlimited, setUnlimited] = useState(true);
  const [hours, setHours] = useState(24);
  const [limit, setLimit] = useState(20);
  const [concurrency, setConcurrency] = useState(1);
  const [roots, setRoots] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{error:boolean;text:string}|null>(null);
  const inFlight = useRef(false);
  const toggle = (value:string, values:string[], update:(v:string[])=>void) => update(values.includes(value)?values.filter(v=>v!==value):[...values,value]);
  async function submit(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current || busy) return;
    setFeedback(null);
    const allowedRoots=roots.split("\n").map(s=>s.trim()).filter(Boolean);
    const fail=(text:string)=>setFeedback({error:true,text});
    if (!selected.length) return fail("请至少选择一个项目。");
    if (!allOperations && !actions.length) return fail("请至少选择一项允许操作，或开启所有操作。");
    if (!allOperations && actions.includes("project.create") && !allowedRoots.length) return fail("请填写允许创建项目的目录，或切换为默认的所有操作。");
    if (!Number.isInteger(concurrency) || concurrency<1 || concurrency>20) return fail("最大并发须为 1–20。");
    if (!permanent && (!Number.isInteger(hours) || hours<1 || hours>8760)) return fail("有效小时须为 1–8760。");
    if (!unlimited && (!Number.isInteger(limit) || limit<1 || limit>10000)) return fail("操作次数上限须为 1–10000。");
    inFlight.current=true;setSubmitting(true);
    try {
      await onCreate({name:name.trim() || `${projects.filter(p=>selected.includes(p.id)).map(p=>p.name).join("、")}授权`.slice(0,200),projectIds:selected,
        ...(allOperations?{allOperations:true}:{capabilities:actions,allowedRoots}),
        expiresAt:permanent?null:Date.now()+hours*3600000,maxActions:unlimited?null:limit,maxConcurrency:concurrency});
      setFeedback({error:false,text:"授权已创建，可在授权列表中使用。"});
    } catch(error) { fail(error instanceof Error?error.message:"创建失败，请重试。"); }
    finally {inFlight.current=false;setSubmitting(false);}
  }
  return <div className="rounded-md border border-border/70 p-3">
    <h3 className="font-medium">创建授权</h3>
    <p className="mt-1 text-xs text-muted-foreground">选择项目即可创建：默认允许这些项目的全部当前可授权操作，长期有效，直至撤销。</p>
    <form noValidate className="mt-3 space-y-3" onSubmit={submit}>
      <fieldset disabled={submitting || busy} className="space-y-1"><legend>项目范围</legend>
        {projects.map(p=><label key={p.id} className="flex gap-2"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id,selected,setSelected)} />{p.name}</label>)}
      </fieldset>
      <details className="rounded-md border border-border/70 p-3"><summary className="cursor-pointer">高级设置（可选）</summary>
        <fieldset disabled={submitting || busy} className="mt-3 space-y-3">
          <label className="block">授权名称（可选）<Input maxLength={200} value={name} placeholder="按所选项目自动命名" onChange={e=>setName(e.target.value)} /></label>
          <label className="flex gap-2"><input type="checkbox" checked={allOperations} onChange={e=>setAllOperations(e.target.checked)} />允许所有当前可授权操作</label>
          <p className="text-xs text-muted-foreground">{allOperations?"目录权限仅限所选项目目录内。":"自定义模式按填写的根目录授权。"}未来新增操作和新建项目不会自动加入授权。</p>
          {!allOperations && <><fieldset className="grid gap-2 sm:grid-cols-2"><legend>允许操作</legend>{[...new Set(capabilities.map(c=>c.capability))].map(id=><label key={id} className="flex gap-2"><input type="checkbox" checked={actions.includes(id)} onChange={()=>toggle(id,actions,setActions)} /><span>{names[id]??id}</span></label>)}</fieldset>
          {actions.includes("project.create") && <label className="block">允许创建项目的根目录（每行一个绝对路径）<textarea className="w-full rounded-md border border-border bg-background p-2" value={roots} onChange={e=>setRoots(e.target.value)} /></label>}</>}
          <label className="flex gap-2"><input type="checkbox" checked={permanent} onChange={e=>setPermanent(e.target.checked)} />长期有效，直到撤销</label>
          <label className="flex gap-2"><input type="checkbox" checked={unlimited} onChange={e=>setUnlimited(e.target.checked)} />不限制累计操作次数</label>
          <div className="grid grid-cols-3 gap-2">
            <label>有效小时<Input type="number" min={1} max={8760} disabled={permanent} value={hours} onChange={e=>setHours(Number(e.target.value))} /></label>
            <label>操作次数上限<Input type="number" min={1} max={10000} disabled={unlimited} value={limit} onChange={e=>setLimit(Number(e.target.value))} /></label>
            <label>最大并发<Input type="number" min={1} max={20} value={concurrency} onChange={e=>setConcurrency(Number(e.target.value))} /></label>
          </div>
        </fieldset>
      </details>
      <Button type="submit" size="sm" disabled={busy || submitting}>{submitting?"正在创建…":"创建授权"}</Button>
      {feedback && <p role={feedback.error?"alert":"status"} className={feedback.error?"text-destructive":"text-muted-foreground"}>{feedback.text}</p>}
    </form>
  </div>;
}

function ManagementRow({ project }: { project: ManagedProject }) {
  const client = useQueryClient();
  const [form, setForm] = useState(project.management);
  const mutation = useMutation({
    mutationFn: () =>
      updateProjectManagement(project.id, {
        mode: form.mode,
        ownerLabel: form.ownerLabel,
        nextAction: form.nextAction,
        freshnessHours: form.freshnessHours,
        expectedRevision: project.management.revision,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["project-management-overview"] }),
  });
  return (
    <div className="rounded-md border border-border/70 p-3 space-y-2">
      <div className="flex justify-between gap-2">
        <a
          className="font-medium hover:underline"
          href={`/projects/${project.id}`}
        >
          {project.name}
        </a>
        <span className="text-xs">
          {project.management.mode === "manual" ? "人工项目" : "CLI 规划"} ·
          人工执行
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {project.goal?.summary || "尚未设置目标"}
      </p>
      <p className="text-xs">
        完成 {project.counts.done}/{project.counts.total} · 进行中{" "}
        {project.counts.in_progress} · 阻塞 {project.counts.blocked} · 证据
        {
          { unknown: "时间未知", stale: "已过期", fresh: "新鲜" }[
            project.evidenceFreshness.status
          ]
        }
      </p>
      <details>
        <summary className="cursor-pointer text-xs">
          负责人及下一步：{project.management.ownerLabel || "未指定"} ·{" "}
          {project.management.nextAction || "待安排"}
        </summary>
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="block">
            管理模式
            <select
              className="ml-2 rounded border border-border bg-background p-1"
              value={form.mode}
              onChange={(e) =>
                setForm({ ...form, mode: e.target.value as "manual" | "cli" })
              }
            >
              <option value="manual">人工</option>
              <option value="cli">CLI 规划（仍需人工执行）</option>
            </select>
          </label>
          <label className="block">
            负责人
            <Input
              value={form.ownerLabel}
              onChange={(e) => setForm({ ...form, ownerLabel: e.target.value })}
            />
          </label>
          <label className="block">
            下一步
            <Input
              value={form.nextAction}
              onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
            />
          </label>
          <label className="block">
            证据有效小时
            <Input
              type="number"
              min="1"
              max="8760"
              value={form.freshnessHours}
              onChange={(e) =>
                setForm({ ...form, freshnessHours: Number(e.target.value) })
              }
            />
          </label>
          {mutation.isError && (
            <p role="alert" className="text-destructive">
              保存失败：{mutation.error.message}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void client.invalidateQueries({
                    queryKey: ["project-management-overview"],
                  })
                }
              >
                重新加载
              </Button>
            </p>
          )}
          <Button size="sm" disabled={mutation.isPending}>
            保存管理信息
          </Button>
        </form>
      </details>
    </div>
  );
}
