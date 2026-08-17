"use client";

import { MessageSquare } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";

/**
 * Feishu channel bindings are provisioned through the Portfolio API; the web
 * settings page only explains where chats route (bound chats -> portfolio
 * requirement capture, unbound chats -> copilot conversation).
 */
export function FeishuIntegrationSettings() {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <CardTitle>{t("settings.feishuIntegration")}</CardTitle>
        </div>
        <CardDescription className="mt-2">
          {t("settings.feishuIntegrationDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {t("settings.feishuRouting")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("settings.feishuCommands")}
        </p>
      </CardContent>
    </Card>
  );
}
