"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { collaborationApi, hasCapability, type MemberRole, type WorkspaceDetail } from "@/lib/collaboration-api";
import { ErrorNotice, Field, inputClass, Panel, useWorkspaceAction, WorkspaceStatus } from "@/components/workspaces/WorkspaceShared";
interface Props { detail: WorkspaceDetail; }
export function ProjectMembers({ detail }: Props) {
  const {t}=useLanguage();
  const {project,members}=detail;
  const action=useWorkspaceAction(project.id);
  const [email,setEmail]=useState("");
  const [role,setRole]=useState<MemberRole>("viewer");
  const [notice,setNotice]=useState("");
  const [revokeId,setRevokeId]=useState<string|null>(null);
  const owner=hasCapability(project,"manage");
  return <div className="space-y-4">
      <Panel title={t("workspace.members")}>
        <p className="text-xs text-muted-foreground">
          {t("workspace.memberHint")}
        </p>
        <ul className="divide-y divide-border/70">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="min-w-0 break-words">
                {member.displayName || member.email}
                <div className="mt-1 flex gap-2">
                  <WorkspaceStatus value={member.role} />
                  <WorkspaceStatus value={member.state} />
                </div>
              </div>
              {owner && member.role !== "owner" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => setRevokeId(member.userId)}
                >
                  {t("workspace.revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {revokeId && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm">{t("workspace.revokeHint")}</p>
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() =>
                action.mutate(async () => {
                  const result = await collaborationApi.revoke(
                    project.id,
                    revokeId,
                  );
                  setNotice(`${t("workspace.revoked")} ${result.pendingStops}`);
                  setRevokeId(null);
                })
              }
            >
              {t("workspace.confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevokeId(null)}>
              {t("workspace.cancel")}
            </Button>
          </div>
        )}
        {owner && (
          <form
            className="space-y-3 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate(async () => {
                await collaborationApi.member(project.id, email.trim(), role);
                setEmail("");
                setNotice(t("workspace.saved"));
              });
            }}
          >
            <Field label={t("workspace.email")}>
              <input
                type="email"
                disabled={action.isPending}
                required
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t("workspace.role")}>
              <select
                className={inputClass}
                value={role}
                disabled={action.isPending}
                onChange={(e) => setRole(e.target.value as MemberRole)}
              >
                {(["viewer", "developer", "reviewer"] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`workspace.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Button size="sm" disabled={action.isPending}>
              {t("common.save")}
            </Button>
          </form>
        )}
      </Panel>
    <ErrorNotice error={action.error} />
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
