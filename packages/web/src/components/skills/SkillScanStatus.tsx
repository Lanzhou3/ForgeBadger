"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Folder,
  Info,
} from "lucide-react";
import { useTrilingual } from "@/hooks/use-trilingual";
import type { SkillDiscovery } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  discovery: SkillDiscovery;
}

export function SkillScanStatus({ discovery }: Props) {
  const pick = useTrilingual();
  const [open, setOpen] = useState(false);
  const rejected = discovery.rejectedSkills ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-4 text-xs">
        <div
          className="flex flex-wrap items-center gap-2 text-muted-foreground"
          role="status"
        >
          {rejected.length ? (
            <AlertTriangle className="size-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="size-4 text-muted-foreground" />
          )}
          <span>
            {pick(
              `已发现 ${discovery.discoveredCount} 个本地 Skill`,
              `已發現 ${discovery.discoveredCount} 個本機 Skill`,
              `${discovery.discoveredCount} local Skills found`,
            )}
          </span>
          {rejected.length ? (
            <span className="text-amber-600 dark:text-amber-300">
              ·{" "}
              {pick(
                `${rejected.length} 项未导入`,
                `${rejected.length} 項未匯入`,
                `${rejected.length} not imported`,
              )}
            </span>
          ) : null}
        </div>
        <Button
          id="skill-scan-details"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
        >
          {pick("扫描详情", "掃描詳情", "Scan details")}
          <ChevronDown />
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="skills-dialog max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("skill-scan-details")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {pick("本地扫描", "本機掃描", "Local scan")}
            </DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-3 gap-4 rounded-md border border-border/70 p-4 text-sm">
            {[
              [pick("发现", "發現", "Found"), discovery.discoveredCount],
              [pick("新增", "新增", "Added"), discovery.createdCount],
              [pick("已更新", "已更新", "Updated"), discovery.updatedCount],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              {pick("扫描目录", "掃描目錄", "Scan directories")}
            </h3>
            {discovery.roots.map((root) => (
              <div
                key={root}
                className="flex items-start gap-2 rounded-md bg-muted/30 p-3 text-xs"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <code className="break-all">{root}</code>
              </div>
            ))}
          </div>
          {rejected.length ? (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-md border border-amber-500/30 p-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="size-4 text-amber-500" />
                {pick(
                  "未导入的资源包",
                  "未匯入的資源包",
                  "Packages not imported",
                )}
              </h3>
              <ul className="flex flex-col gap-3 text-xs">
                {rejected.map((item) => (
                  <li key={item.path} className="flex flex-col gap-1">
                    <code className="break-all">{item.path}</code>
                    <span className="break-words text-muted-foreground">
                      {item.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="text-xs text-muted-foreground">
            <summary className="flex cursor-pointer items-center gap-2">
              <Info className="size-3.5" />
              {pick("配置扫描目录", "設定掃描目錄", "Configure directories")}
            </summary>
            <p className="mt-3 leading-relaxed">
              {pick(
                "默认扫描 Claude Code 与 Agents 的 skills 目录。自定义目录请设置 Gateway 启动环境中的 FORGEBADGER_SKILL_DIRS、CLAUDE_CONFIG_DIR 或 AGENTS_HOME。",
                "預設掃描 Claude Code 與 Agents 的 skills 目錄。自訂目錄請設定 Gateway 啟動環境中的 FORGEBADGER_SKILL_DIRS、CLAUDE_CONFIG_DIR 或 AGENTS_HOME。",
                "By default, scans Claude Code and Agents skills directories. Configure FORGEBADGER_SKILL_DIRS, CLAUDE_CONFIG_DIR or AGENTS_HOME in the Gateway environment to change them.",
              )}
            </p>
          </details>
        </DialogContent>
      </Dialog>
    </>
  );
}
