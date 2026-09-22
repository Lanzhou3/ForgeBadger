"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import type { TranslationKey } from "@/lib/i18n";
import {
  getRuntimeSettings,
  runtimeSettingsMeta,
  runtimeSettingsValue,
  updateRuntimeSettings,
} from "@/lib/api";
import { toast } from "@/lib/toast";

export const runtimeSettingsQueryKey = ["runtime-settings"] as const;

/**
 * Instance settings card: registration mode and the terminal session name
 * prefix, stored as DB overrides on top of the .env defaults. Admin-only;
 * the API enforces the same boundary.
 */
export function InstanceRuntimeSettings() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [registration, setRegistration] = useState<string>("");
  const [prefix, setPrefix] = useState("");
  const [dirty, setDirty] = useState(false);

  const settings = useQuery({
    queryKey: runtimeSettingsQueryKey,
    queryFn: getRuntimeSettings,
    retry: false,
    enabled: user?.role === "admin",
  });

  useEffect(() => {
    if (!settings.data) return;
    setRegistration(runtimeSettingsValue(settings.data, "registration") ?? "open");
    setPrefix(runtimeSettingsValue(settings.data, "session_prefix") ?? "");
    setDirty(false);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      updateRuntimeSettings({
        registration: registration as "open" | "off" | "invite",
        session_prefix: prefix
      }),
    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey });
      toast.success(t("settings.instanceSaved"));
    },
    onError: () => toast.error(t("settings.instanceSaveError")),
  });

  if (user?.role !== "admin") return null;

  const readonly = settings.data?.readonly ?? false;
  const registrationSource = settings.data ? runtimeSettingsMeta(settings.data, "registration")?.source : undefined;
  const prefixSource = settings.data ? runtimeSettingsMeta(settings.data, "session_prefix")?.source : undefined;

  return (
    <Card className="forgebadger-animate-in">
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Server className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm font-semibold">{t("settings.instance")}</CardTitle>
          <CardDescription className="mt-1 text-xs">{t("settings.instanceDescription")}</CardDescription>
        </div>
        {readonly && (
          <Badge variant="outline" className="gap-1">
            <Lock className="size-3" />
            {t("settings.sourceEnv")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {settings.isError ? (
          <p className="text-xs text-destructive">{t("settings.instanceLoadError")}</p>
        ) : settings.isLoading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            {readonly && (
              <p className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                {t("settings.instanceReadonly")}
              </p>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-xs" htmlFor="instance-registration">
                  {t("settings.registration")}
                </Label>
                <SourceBadge source={registrationSource} t={t} />
              </div>
              <Select
                value={registration}
                onValueChange={(value) => {
                  setRegistration(value);
                  setDirty(true);
                }}
                disabled={readonly}
              >
                <SelectTrigger id="instance-registration" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t("settings.registrationOpen")}</SelectItem>
                  <SelectItem value="invite">{t("settings.registrationInvite")}</SelectItem>
                  <SelectItem value="off">{t("settings.registrationOff")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("settings.registrationDescription")}</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-xs" htmlFor="instance-session-prefix">
                  {t("settings.sessionPrefix")}
                </Label>
                <SourceBadge source={prefixSource} t={t} />
              </div>
              <Input
                id="instance-session-prefix"
                value={prefix}
                onChange={(event) => {
                  setPrefix(event.target.value);
                  setDirty(true);
                }}
                placeholder="fb-"
                maxLength={32}
                disabled={readonly}
                className="h-8 w-48 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t("settings.sessionPrefixDescription")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-8"
                disabled={readonly || !dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? t("common.loading") : t("common.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SourceBadge({
  source,
  t
}: {
  source?: "env" | "settings";
  t: (key: TranslationKey) => string;
}) {
  if (!source) return null;
  return (
    <Badge variant={source === "settings" ? "secondary" : "outline"} className="h-4 px-1.5 text-[10px]">
      {source === "settings" ? t("settings.sourceSettings") : t("settings.sourceEnv")}
    </Badge>
  );
}
