"use client";

import Link from "next/link";
import { ArrowUpRight, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";

/**
 * Feishu channel bindings are provisioned by Portfolio Operations, where the
 * required owner and provider-account context is available.
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
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Feishu channel provisioning is managed in Portfolio Operations. This
          settings page does not collect credentials or create legacy
          conversation bindings.
        </p>
        <Button asChild variant="outline">
          <Link href="/portfolio">
            Open Portfolio Operations
            <ArrowUpRight className="ml-2 size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
