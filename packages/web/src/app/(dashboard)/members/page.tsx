"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import {
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
  type AdminUserUpdateInput,
} from "@/lib/api";

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
      <div className="p-6">
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("members.loading")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="size-10 text-muted-foreground" />
            <h1 className="mt-4 text-lg font-semibold">{t("members.accessDeniedTitle")}</h1>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {t("members.accessDeniedDescription")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const members = data?.users ?? [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("members.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("members.subtitle")}</p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("members.loading")}
          </CardContent>
        </Card>
      ) : members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <UsersRound className="size-10 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">{t("members.emptyTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("members.emptyDescription")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("members.role")}</TableHead>
                <TableHead>{t("members.status")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  currentUserId={user.id}
                />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function MemberRow({
  member,
  currentUserId,
}: {
  member: AdminUser;
  currentUserId: string;
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

  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex flex-col gap-1">
          <span>{member.email}</span>
          {isSelf && (
            <span className="text-xs text-muted-foreground">{t("members.selfManaged")}</span>
          )}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </TableCell>
      <TableCell>
        {isSelf ? (
          <Badge variant="secondary">{roleLabel(member.role, t)}</Badge>
        ) : (
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
      </TableCell>
      <TableCell>
        {isSelf ? (
          <Badge variant="outline">{statusLabel(member.status, t)}</Badge>
        ) : (
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          onClick={() => mutation.mutate()}
          disabled={isSelf || mutation.isPending}
        >
          {mutation.isPending ? t("members.saving") : t("members.save")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function roleLabel(role: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return role === "admin" ? t("members.admin") : t("members.user");
}

function statusLabel(status: string, t: ReturnType<typeof useLanguage>["t"]): string {
  return status === "disabled" ? t("members.disabled") : t("members.active");
}
