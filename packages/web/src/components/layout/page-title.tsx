"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { useLanguage } from "@/hooks/use-language";
import { useTrilingual } from "@/hooks/use-trilingual";
import type { Project, Session } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

const routeLabels: Record<string, TranslationKey> = {
  "/": "nav.dashboard",
  "/login": "auth.loginTitle",
  "/register": "auth.registerTitle",
  "/forgot-password": "auth.resetTitle",
  "/projects": "nav.projects",
  "/projects/new": "projects.create",
  "/projects/import": "projects.importTitle",
  "/sessions": "nav.sessions",
  "/models": "nav.models",
  "/cli-config": "nav.models",
  "/skills": "skills.title",
  "/templates": "nav.templates",
  "/copilot": "nav.copilot",
  "/copilot/settings": "copilot.settings",
  "/fleet": "nav.fleet",
  "/notifications": "nav.notifications",
  "/usage": "nav.usage",
  "/members": "nav.members",
  "/teams": "nav.members",
  "/workspaces": "nav.projects",
};

const settingsLabels: Record<string, TranslationKey> = {
  appearance: "settings.section.appearance",
  account: "settings.section.account",
  adapters: "settings.section.adapters",
  integrations: "settings.section.integrations",
  instance: "settings.section.instance",
};

/** Reuse the page's cached data; browser titles never initiate a request. */
export function PageTitle() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams();
  const { t } = useLanguage();
  const pick = useTrilingual();
  const projectMatch = /^\/projects\/([^/]+)$/u.exec(pathname);
  const matchedProjectId = projectMatch?.[1] ?? null;
  const projectId = matchedProjectId && !["new", "import"].includes(matchedProjectId) ? matchedProjectId : null;
  const sessionId = /^\/sessions\/([^/]+)$/u.exec(pathname)?.[1] ?? null;
  const goalId = /^\/copilot\/goals\/([^/]+)$/u.exec(pathname)?.[1] ?? null;
  const fleetId = /^\/fleet\/([^/]+)$/u.exec(pathname)?.[1] ?? null;
  const queryClient = useQueryClient();
  const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
  const entityName = useSyncExternalStore(subscribe, () => {
    if (projectId) return queryClient.getQueryData<{ project: Project }>(["project", projectId])?.project.name ?? null;
    if (sessionId) return queryClient.getQueryData<{ session: Session }>(["session", sessionId])?.session.name ?? null;
    if (goalId) return queryClient.getQueryData<{ goal: { title: string } }>(["copilot", "goals", "detail", goalId])?.goal.title ?? null;
    if (fleetId) return queryClient.getQueryData<{ fleet: { title: string } }>(["fleet", "detail", fleetId])?.fleet.title ?? null;
    return null;
  }, () => null);

  const localLabels: Record<string, string> = {
    "/join": pick("加入团队", "加入團隊", "Join team"),
    "/skills/discover": pick("发现 Skills", "發現 Skills", "Discover Skills"),
    "/skills/install": pick("发现 Skills", "發現 Skills", "Discover Skills"),
    "/skills/sources": pick("来源管理", "來源管理", "Skill sources"),
    "/copilot/goals": pick("目标", "目標", "Goals"),
    "/copilot/tasks": pick("受控开发任务", "受控開發任務", "Development tasks"),
    "/copilot/automations": pick("定时自动化", "定時自動化", "Automations"),
    "/copilot/channels": pick("远程渠道", "遠端頻道", "Remote channels"),
    "/copilot/extensions": pick("Copilot 扩展", "Copilot 擴充", "Copilot extensions"),
  };
  let label = localLabels[pathname] ?? (routeLabels[pathname] ? t(routeLabels[pathname]) : "ForgeBadger");
  if (projectId) label = entityName ? `${entityName} · ${t("nav.projects")}` : t("nav.projects");
  if (sessionId) label = entityName ? `${entityName} · ${t("nav.sessions")}` : t("nav.sessions");
  if (goalId) label = entityName ? `${entityName} · ${localLabels["/copilot/goals"] ?? "Goals"}` : localLabels["/copilot/goals"] ?? "Goals";
  if (fleetId) label = entityName ? `${entityName} · ${t("nav.fleet")}` : t("nav.fleet");
  if (pathname === "/settings") {
    label = `${t(settingsLabels[search.get("section") ?? ""] ?? "settings.section.appearance")} · ${t("nav.settings")}`;
  }
  const title = label === "ForgeBadger" ? label : `${label} · ForgeBadger`;

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
