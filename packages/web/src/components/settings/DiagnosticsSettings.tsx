"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { SettingsCardHeader } from "@/components/settings/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { exportDiagnostics, type LocalDiagnosticsExport } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Diagnostics export card: downloads a sanitized local JSON report. */
export function DiagnosticsSettings() {
  const { t } = useLanguage();
  const [diagnosticsState, setDiagnosticsState] = useState<"idle" | "exporting" | "success" | "error">("idle");

  async function handleDiagnosticsExport() {
    setDiagnosticsState("exporting");
    try {
      const { report } = await exportDiagnostics();
      downloadDiagnosticsReport(report);
      setDiagnosticsState("success");
    } catch {
      setDiagnosticsState("error");
    }
  }

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "40ms" }}>
      <SettingsCardHeader
        icon={<Download className="size-4" />}
        title={t("settings.diagnostics")}
        description={t("settings.diagnosticsDescription")}
      />
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDiagnosticsExport}
          disabled={diagnosticsState === "exporting"}
        >
          <Download className="size-4" />
          {diagnosticsState === "exporting"
            ? t("settings.diagnosticsExporting")
            : t("settings.diagnosticsExport")}
        </Button>
        <p
          className={cn(
            "text-xs",
            diagnosticsState === "success"
              ? "text-emerald-400"
              : diagnosticsState === "error"
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {diagnosticsState === "success"
            ? t("settings.diagnosticsExported")
            : diagnosticsState === "error"
              ? t("settings.diagnosticsExportFailed")
              : t("settings.diagnosticsNotice")}
        </p>
      </CardContent>
    </Card>
  );
}

function downloadDiagnosticsReport(report: LocalDiagnosticsExport) {
  const generatedAt = report.generatedAt.replace(/[:.]/g, "-");
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `forgebadger-diagnostics-${generatedAt}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
