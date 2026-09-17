"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getProjectOverview,
  updateProjectManagement,
  type ManagedProject,
} from "@/lib/platform-actions-api";
import {
  CopilotGrantsPanel,
  type CopilotGrantsPanelProps,
} from "./CopilotGrantsPanel";

/**
 * Chat-sheet management surface: project grants (shared CopilotGrantsPanel)
 * plus the per-project management progress view.
 */
export function CopilotManagementPanel(props: CopilotGrantsPanelProps) {
  return (
    <div className="space-y-6 p-4 text-sm">
      <CopilotGrantsPanel {...props} />
      <ManagementSection />
    </div>
  );
}

function ManagementSection() {
  const overview = useQuery({
    queryKey: ["project-management-overview"],
    queryFn: () => getProjectOverview(),
    refetchInterval: 30000,
  });
  return (
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
  );
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
