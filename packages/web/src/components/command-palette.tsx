"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  FileCode2,
  FolderGit2,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SquarePen,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { navItems } from "@/components/layout/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { listProjects } from "@/lib/api";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  icon: typeof ArrowRight;
  action: () => void;
}

function activeProjectIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/projects\/([^/?#]+)/);
  if (!match?.[1]) return null;
  if (match[1] === "new" || match[1] === "import") return null;
  return decodeURIComponent(match[1]);
}

export function CommandPalette({
  open,
  onOpenChange,
  sidebarCollapsed,
  onToggleSidebar,
}: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const projectsQuery = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: listProjects,
    enabled: open && Boolean(user),
    staleTime: 30_000,
    retry: false,
  });

  const currentProjectId = useMemo(() => activeProjectIdFromPath(pathname), [pathname]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const visibleNavItems = navItems.filter((item) => !item.adminOnly || user?.role === "admin");
    const list: PaletteCommand[] = [
      {
        id: "toggle-copilot",
        label: t("commandPalette.openCopilot"),
        group: t("commandPalette.actions"),
        icon: Bot,
        action: () => {
          window.dispatchEvent(new CustomEvent("forgebadger:toggle-copilot"));
          onOpenChange(false);
        },
      },
      {
        id: "new-copilot-chat",
        label: t("commandPalette.newCopilotChat"),
        group: t("commandPalette.actions"),
        icon: SquarePen,
        action: () => {
          if (pathname?.startsWith("/copilot")) {
            router.push("/copilot");
          } else {
            window.dispatchEvent(new CustomEvent("forgebadger:open-copilot", { detail: { newChat: true } }));
          }
          onOpenChange(false);
        },
      },
      {
        id: "toggle-sidebar",
        label: sidebarCollapsed ? t("commandPalette.showSidebar") : t("commandPalette.hideSidebar"),
        group: t("commandPalette.actions"),
        icon: sidebarCollapsed ? PanelLeftOpen : PanelLeftClose,
        action: () => {
          onToggleSidebar();
          onOpenChange(false);
        },
      },
    ];

    if (currentProjectId) {
      const projectGroup = t("projects.commandInProjectGroup");
      const basePath = `/projects/${encodeURIComponent(currentProjectId)}`;
      const projectActions: Array<{ id: string; label: string; query?: string; icon: typeof ArrowRight }> = [
        { id: "overview", label: t("projects.tabOverview"), icon: LayoutDashboard },
        { id: "project-manager", label: t("projects.devTasks"), query: "tab=project-manager", icon: ListChecks },
        { id: "files", label: `${t("projects.tabCode")} · ${t("projects.filesTab")}`, query: "tab=code", icon: FolderGit2 },
        { id: "git", label: `${t("projects.tabCode")} · ${t("projects.gitTab")}`, query: "tab=code&view=git", icon: GitBranch },
        { id: "graph", label: `${t("projects.tabCode")} · ${t("projects.graphTab")}`, query: "tab=code&view=graph", icon: Network },
        { id: "config", label: t("projects.aiConfig"), query: "tab=config", icon: FileCode2 },
      ];
      for (const act of projectActions) {
        list.push({
          id: `project-tab:${act.id}`,
          label: act.label,
          group: projectGroup,
          icon: act.icon,
          action: () => {
            router.push(act.query ? `${basePath}?${act.query}` : basePath);
            onOpenChange(false);
          },
        });
      }
    }

    for (const item of visibleNavItems) {
      list.push({
        id: `nav:${item.href}`,
        label: t(item.labelKey),
        group: t("commandPalette.navigation"),
        icon: item.icon,
        action: () => {
          router.push(item.href);
          onOpenChange(false);
        },
      });
    }

    for (const project of projectsQuery.data?.projects ?? []) {
      list.push({
        id: `project:${project.id}`,
        label: `${project.name} — ${project.rootPath ?? project.path}`,
        group: t("projects.commandSearchGroup"),
        icon: FolderGit2,
        action: () => {
          router.push(`/projects/${encodeURIComponent(project.id)}`);
          onOpenChange(false);
        },
      });
    }

    return list;
  }, [
    currentProjectId,
    onOpenChange,
    onToggleSidebar,
    pathname,
    projectsQuery.data?.projects,
    router,
    sidebarCollapsed,
    t,
    user?.role,
  ]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredCommands = normalizedQuery
    ? commands.filter(
        (command) =>
          command.label.toLowerCase().includes(normalizedQuery) ||
          command.group.toLowerCase().includes(normalizedQuery),
      )
    : commands;
  const activeIndex = filteredCommands.length > 0 ? Math.min(selectedIndex, filteredCommands.length - 1) : -1;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuery("");
          setSelectedIndex(0);
        }
      }}
    >
      <DialogContent className="gap-3 p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base">{t("commandPalette.title")}</DialogTitle>
          <DialogDescription>{t("commandPalette.description")}</DialogDescription>
        </DialogHeader>
        <div className="px-4">
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={(event) => {
                if (filteredCommands.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelectedIndex((current) => (current + 1) % filteredCommands.length);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelectedIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length);
                } else if (event.key === "Enter" && activeIndex >= 0) {
                  event.preventDefault();
                  filteredCommands[activeIndex]?.action();
                }
              }}
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              placeholder={t("commandPalette.placeholder")}
            />
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto px-2 pb-2" role="listbox">
          {filteredCommands.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t("commandPalette.noResults")}
            </div>
          ) : (
            filteredCommands.map((command, index) => (
              <Button
                key={command.id}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={index === activeIndex}
                className={`h-auto w-full justify-start gap-3 rounded-md px-3 py-3 text-left ${index === activeIndex ? "bg-accent text-accent-foreground" : ""}`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={command.action}
              >
                <command.icon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{command.label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{command.group}</span>
                </span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
