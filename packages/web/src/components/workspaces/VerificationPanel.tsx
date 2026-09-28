"use client";
import { useLanguage } from "@/hooks/use-language";
import type { RunDetail } from "@/lib/collaboration-api";
import { Panel, WorkspaceStatus } from "./WorkspaceShared";

/** Historical receipts only; automated verification execution has been retired. */
export function VerificationPanel({ detail }: { detail: RunDetail }) {
  const { t } = useLanguage();
  const { run } = detail;
  return (
    <Panel title={t("workspace.verification")}>
      <p className="text-xs text-muted-foreground">{t("workspace.noVerification")}</p>
        {detail.verifications.length ? (
          <ul className="space-y-2">
            {detail.verifications.map((receipt) => (
              <li
                key={receipt.id}
                className="space-y-2 rounded-md border border-border/70 p-3"
              >
                <div className="flex flex-wrap gap-2">
                  <WorkspaceStatus value={receipt.status} />
                  {receipt.status === "passed" && receipt.current !== true && (
                    <span className="text-xs text-amber-500">
                      {t(
                        run.state === "ready"
                          ? "workspace.staleReceipt"
                          : "workspace.historicalReceipt",
                      )}
                    </span>
                  )}
                  <code className="text-xs">{receipt.commit.slice(0, 12)}</code>
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">
                  {receipt.summary}
                </pre>
                {receipt.status === "unknown" && (
                  <p className="text-xs text-amber-500">
                    {t("workspace.unknownHint")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("workspace.noReceipts")}
          </p>
        )}
    </Panel>
  );
}
