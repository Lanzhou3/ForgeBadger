"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import {
  collaborationApi,
  hasCapability,
  canReview,
  type RunDetail,
  type WorkspaceDetail,
} from "@/lib/collaboration-api";
import {
  ErrorNotice,
  Field,
  inputClass,
  Panel,
  useWorkspaceAction,
  WorkspaceStatus,
} from "./WorkspaceShared";
interface Props {
  project: WorkspaceDetail["project"];
  detail: RunDetail;
  actorId?: string;
  reviewerId?: string | null;
  team: boolean;
}
export function RunReview({
  project,
  detail,
  actorId,
  reviewerId,
  team,
}: Props) {
  const { t } = useLanguage();
  const action = useWorkspaceAction(project.id);
  const [note, setNote] = useState("");
  const receipt = detail.verifications.find(
    (r) =>
      r.status === "passed" &&
      r.current === true &&
      r.commit === detail.git.commit,
  );
  const latestReceipt = detail.verifications.find(
    (r) => r.commit === detail.git.commit,
  );
  const allowed =
    canReview(project, actorId, detail.run.actorId, team) &&
    (!reviewerId || reviewerId === actorId);
  const ready =
    detail.run.state === "ready" &&
    !detail.git.dirty &&
    !detail.git.conflicts?.length &&
    !detail.git.error &&
    !detail.run.operation;
  return (
    <Panel title={t("workspace.review")}>
      <p className="text-xs text-muted-foreground">
        {t("workspace.reviewHint")}
      </p>
      {detail.reviews.length ? (
        <ul className="space-y-2">
          {detail.reviews.map((review) => (
            <li
              key={review.id}
              className="rounded-md border border-border/70 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <WorkspaceStatus value={review.decision} />
                <span>{review.actorLabel}</span>
                <code className="text-xs">{review.commit.slice(0, 12)}</code>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words">
                {review.note}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("workspace.noReviews")}
        </p>
      )}
      {reviewerId && reviewerId !== actorId && (
        <p className="text-xs text-muted-foreground">
          {t("workspace.assignedReviewer")}
        </p>
      )}
      {allowed && (
        <div className="space-y-3">
          <Field label={t("workspace.reviewNote")}>
            <textarea
              maxLength={5000}
              required
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!ready || !receipt || !note.trim() || action.isPending}
              onClick={() =>
                receipt &&
                action.mutate(() =>
                  collaborationApi.review(project.id, detail.run.id, {
                    expectedCommit: detail.git.commit,
                    verificationId: receipt.id,
                    decision: "accepted",
                    note: note.trim(),
                  }),
                )
              }
            >
              {t("workspace.accept")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !ready || !latestReceipt || !note.trim() || action.isPending
              }
              onClick={() =>
                latestReceipt &&
                action.mutate(() =>
                  collaborationApi.review(project.id, detail.run.id, {
                    expectedCommit: detail.git.commit,
                    verificationId: latestReceipt.id,
                    decision: "changes_requested",
                    note: note.trim(),
                  }),
                )
              }
            >
              {t("workspace.requestChanges")}
            </Button>
          </div>
        </div>
      )}
      <ErrorNotice error={action.error} />
    </Panel>
  );
}
