"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Bot,
  FolderKanban,
  TerminalSquare,
  Wrench,
  LayoutTemplate,
  Brain,
  BarChart3,
  History,
  Settings,
  Bell,
  Menu,
  LogOut,
  UsersRound,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { brandAssets } from "@/lib/brand-assets";
import { useNotifications } from "@/hooks/use-notifications";
import { formatRelativeTime, latestUnread } from "@/lib/notifications";
import type { TranslationKey } from "@/lib/i18n";

type NavGroupId = "workspace" | "resources" | "system";

export interface NavItem {
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  group: NavGroupId;
  adminOnly?: boolean;
}

export const navItems = [
  { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard, group: "workspace" },
  { labelKey: "nav.projects", href: "/projects", icon: FolderKanban, group: "workspace" },
  { labelKey: "nav.sessions", href: "/sessions", icon: TerminalSquare, group: "workspace" },
  { labelKey: "nav.copilot", href: "/copilot", icon: Bot, group: "workspace" },
  { labelKey: "nav.skills", href: "/skills", icon: Wrench, group: "resources" },
  { labelKey: "nav.templates", href: "/templates", icon: LayoutTemplate, group: "resources" },
  { labelKey: "nav.models", href: "/models", icon: Brain, group: "resources" },
  { labelKey: "nav.usage", href: "/usage", icon: BarChart3, group: "system" },
  { labelKey: "nav.history", href: "/history", icon: History, group: "system" },
  { labelKey: "nav.members", href: "/members", icon: UsersRound, group: "system", adminOnly: true },
  { labelKey: "nav.notifications", href: "/notifications", icon: Bell, group: "system" },
  { labelKey: "nav.settings", href: "/settings", icon: Settings, group: "system" },
] satisfies NavItem[];

const navGroupOrder: Array<{ id: NavGroupId; labelKey: TranslationKey }> = [
  { id: "workspace", labelKey: "nav.groupWorkspace" },
  { id: "resources", labelKey: "nav.groupResources" },
  { id: "system", labelKey: "nav.groupSystem" },
];

function groupNavItems(items: NavItem[]) {
  return navGroupOrder
    .map((group) => ({ ...group, items: items.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length > 0);
}

function UnreadPreviewPopover({ children }: { children: ReactNode }) {
  const { t, language } = useLanguage();
  const { notifications } = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = latestUnread(notifications, 5);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="block"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-72 p-0"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="border-b border-border/70 px-3 py-2 text-xs font-semibold text-muted-foreground">
          {t("notifications.title")}
        </div>
        {unread.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {t("notifications.noUnread")}
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {unread.map((notification) => (
              <Link
                key={notification.id}
                href={notification.href}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2 rounded px-3 py-2 transition-colors hover:bg-muted/40"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {t(notification.titleKey)}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {notification.message}
                  </span>
                  <span className="block text-[11px] text-muted-foreground/70">
                    {formatRelativeTime(notification.createdAt, language)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
        <div className="border-t border-border/70 p-1">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex h-8 items-center justify-center rounded text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            {t("notifications.viewAll")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NavLinkItem({
  item,
  active,
  collapsed,
  unreadCount,
  unreadPreview = false,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  unreadCount: number;
  unreadPreview?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useLanguage();
  const showBadge = item.href === "/notifications" && unreadCount > 0;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-label={collapsed ? t(item.labelKey) : undefined}
      title={collapsed ? t(item.labelKey) : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors duration-150",
        collapsed ? "justify-center px-2" : "px-2.5",
        active
          ? "bg-brand/10 text-foreground"
          : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
      )}
    >
      <item.icon
        className={cn(
          "size-4 shrink-0 transition-colors duration-150",
          active ? "text-brand" : "text-muted-foreground/70 group-hover:text-foreground"
        )}
      />
      <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>
        {t(item.labelKey)}
      </span>
      {showBadge && (
        <span
          className={cn(
            "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground",
            collapsed && "absolute right-0.5 top-0.5 size-2 min-w-2 p-0 text-[0px]"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );

  if (item.href !== "/notifications" || collapsed || !unreadPreview) {
    return link;
  }
  return <UnreadPreviewPopover>{link}</UnreadPreviewPopover>;
}

function NavLinks({
  collapsed = false,
  unreadPreview = false,
  onNavigate,
}: {
  collapsed?: boolean;
  unreadPreview?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const visibleItems = navItems.filter((item) => !item.adminOnly || user?.role === "admin");
  const groups = groupNavItems(visibleItems);

  return (
    <nav className="flex-1 overflow-y-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {groups.map((group, groupIndex) => (
        <div key={group.id} className={cn(groupIndex > 0 && "mt-3")}>
          {collapsed ? (
            groupIndex > 0 && <div className="mx-2 my-2 h-px bg-border/60" aria-hidden="true" />
          ) : (
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50 select-none">
              {t(group.labelKey)}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavLinkItem
                key={item.href}
                item={item}
                active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                collapsed={collapsed}
                unreadCount={unreadCount}
                unreadPreview={unreadPreview}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function BrandMark({ className }: { className?: string }) {
  // The logo artwork is a self-contained squircle app icon with a faint light
  // edge ring and transparent margin baked in, and its tile sits slightly
  // above the canvas center; scale up (with a small downward nudge) inside a
  // clipped frame so the tile renders full-bleed without the fringe.
  return (
    <div className={cn("size-8 shrink-0 overflow-hidden rounded-lg", className)}>
      <img
        src={brandAssets.logoSvg}
        alt=""
        className="size-full translate-y-[1.2%] scale-[1.28] select-none object-cover"
        aria-hidden="true"
        draggable={false}
      />
    </div>
  );
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";

  const BrandHeader = (
    <div className="flex items-center gap-2.5 px-3 pb-3 select-none">
      <BrandMark />
      <div className="min-w-0 text-[15px] font-semibold tracking-tight">ForgeBadger</div>
    </div>
  );

  const UserSection = (
    <div className="mt-auto border-t border-white/[0.06] px-2 py-2.5">
      <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1">
        <Avatar size="sm" className="size-6">
          <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
          {user?.email ?? t("nav.guest")}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => logout()}
          aria-label={t("nav.logout")}
          title={t("nav.logout")}
        >
          <LogOut className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  const CollapseHandle = onToggleCollapse ? (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-label={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
      title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
      className="absolute -right-3 top-1/2 z-20 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.08] bg-[#0b0f16] text-muted-foreground opacity-0 shadow-lg transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover/sidebar:opacity-100"
    >
      {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
    </button>
  ) : null;

  return (
    <>
      {/* Mobile trigger */}
      <div className="fixed left-4 top-4 z-50 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open navigation">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[232px] p-0">
            <div className="flex h-full flex-col py-3">
              <SheetTitle className="sr-only">ForgeBadger navigation</SheetTitle>
              {BrandHeader}
              <NavLinks onNavigate={() => setOpen(false)} />
              {UserSection}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "group/sidebar relative hidden h-full flex-col border-r border-white/[0.06] bg-[#080b10] bg-gradient-to-b from-white/[0.02] to-transparent py-3 transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-[60px]" : "w-[220px]"
        )}
      >
        {CollapseHandle}
        {collapsed ? (
          <>
            <div className="flex justify-center px-2 pb-3">
              <BrandMark />
            </div>
            <NavLinks collapsed />
            <div className="mt-auto flex flex-col items-center gap-2.5 border-t border-white/[0.06] px-2 pt-3">
              <Avatar size="sm" className="size-6">
                <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
              </Avatar>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => logout()}
                aria-label={t("nav.logout")}
                title={t("nav.logout")}
              >
                <LogOut className="size-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <>
            {BrandHeader}
            <NavLinks unreadPreview />
            {UserSection}
          </>
        )}
      </aside>
    </>
  );
}
