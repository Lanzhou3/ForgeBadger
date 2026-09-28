"use client";
import { useTaskAuthority } from "./TaskAuthority";
import { useLanguage } from "@/hooks/use-language";
import { hasCapability } from "@/lib/collaboration-api";
import { Field, inputClass } from "@/components/workspaces/WorkspaceShared";
export function TaskAssignments({
  assigneeId,
  reviewerId,
  onChange,
  disabled,
}: {
  assigneeId?: string | null;
  reviewerId?: string | null;
  onChange: (value: {
    assigneeId?: string | null;
    reviewerId?: string | null;
  }) => void;
  disabled: boolean;
}) {
  const { collaboration } = useTaskAuthority();
  const { t } = useLanguage();
  if (!collaboration) return null;
  const members = collaboration.members.filter((m) => m.state === "active");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("workspace.assignee")}>
        <select
          className={inputClass}
          value={assigneeId ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ assigneeId: e.target.value || null })}
        >
          <option value="">{t("workspace.unassigned")}</option>
          {members
            .filter((m) => hasCapability(m, "develop"))
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
        </select>
      </Field>
      <Field label={t("workspace.reviewAssignee")}>
        <select
          className={inputClass}
          value={reviewerId ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ reviewerId: e.target.value || null })}
        >
          <option value="">{t("workspace.unassigned")}</option>
          {members
            .filter(
              (m) => hasCapability(m, "review") && m.userId !== assigneeId,
            )
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email}
              </option>
            ))}
        </select>
      </Field>
    </div>
  );
}
