"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import {
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
  type AdminUserUpdateInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function MembersPage() {
  const { t } = useLanguage();
  const { user, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: listAdminUsers,
    enabled: isAdmin,
  });

  if (authLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("members.loading")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <Card className="forgebadger-animate-in">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <h1 className="text-sm font-medium">{t("members.accessDeniedTitle")}</h1>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                {t("members.accessDeniedDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const members = data?.users ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("members.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("members.subtitle")}</p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("members.loading")}
          </CardContent>
        </Card>
      ) : members.length === 0 ? (
        <Card className="forgebadger-animate-in">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-md bg-brand/10 text-brand">
              <UsersRound className="size-5" />
            </div>
            <div>
              <div className="text-sm font-medium">{t("members.emptyTitle")}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("members.emptyDescription")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center gap-3 px-4 py-2.5 text-xs font-medium text-muted-foreground">
            <div className="min-w-0 flex-1">{t("common.name")}</div>
            <div className="w-36 shrink-0">{t("members.role")}</div>
            <div className="w-36 shrink-0">{t("members.status")}</div>
            <div className="w-20 shrink-0 text-right">{t("common.actions")}</div>
          </div>
          {members.map((member, index) => (
            <MemberRow
              key={member.id}
              member={member}
              currentUserId={user.id}
              index={index}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberRow({
  member,
  currentUserId,
  index,
}: {
  member: AdminUser;
  currentUserId: string;
  index: number;
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const isSelf = member.id === currentUserId;
  const [form, setForm] = useState<AdminUserUpdateInput>({
    role: member.role === "admin" ? "admin" : "user",
    status: member.status === "disabled" ? "disabled" : "active",
  });
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => updateAdminUser(member.id, form),
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("members.updateFailed"));
    },
  });

  const effectiveStatus = isSelf ? member.status : form.status;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 transition-colors forgebadger-animate-in hover:bg-muted/40"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{member.email}</div>
        {isSelf && (
          <div className="mt-0.5 text-xs text-muted-foreground">{t("members.selfManaged")}</div>
        )}
        {error && <div className="mt-0.5 text-xs text-destructive">{error}</div>}
      </div>
      <div className="w-36 shrink-0">
        {isSelf ? (
          <Badge variant="secondary">{roleLabel(member.role, t)}</Badge>
        ) : (
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={form.role}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                role: event.target.value === "admin" ? "admin" : "user",
              }))
            }
          >
            <option value="user">{t("members.user")}</option>
            <option value="admin">{t("members.admin")}</option>
          </select>
        )}
      </div>
      <div className="flex w-36 shrink-0 items-center gap-2">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            effectiveStatus === "disabled" ? "bg-muted-foreground/40" : "bg-emerald-400"
          )}
        />
        {isSelf ? (
          <Badge variant="outline">{statusLabel(member.status, t)}</Badge>
        ) : (
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value === "disabled" ? "disabled" : "active",
              }))
            }
          >
            <option value="active">{t("members.active")}</option>
            <option value="disabled">{t("members.disabled")}</option>
          </select>
        )}
      </div>
      <div className="flex w-20 shrink-0 justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => mutation.mutate()}
          disabled={isSelf || mutation.isPending}
        >
          {mutation.isPending ? t("members.saving") : t("members.save")}
        </Button>
      </div>
    </div>
  );
}

function roleLabel(role: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return role === "admin" ? t("members.admin") : t("members.user");
}

function statusLabel(status: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return status === "disabled" ? t("members.disabled") : t("members.active");
}
