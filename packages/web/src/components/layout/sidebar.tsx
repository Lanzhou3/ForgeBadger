"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Bot,
  Ship,
  FolderKanban,
  TerminalSquare,
  Wrench,
  LayoutTemplate,
  Brain,
  BarChart3,
  Settings,
  Bell,
  Menu,
  LogOut,
  UsersRound,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { Tooltip } from "radix-ui";
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
import styles from "./sidebar.module.css";

type NavGroupId = "workspace" | "resources" | "system";

export interface NavItem {
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  group: NavGroupId;
  adminOnly?: boolean;
  iconColor: "neutral" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";
}

export const navItems: NavItem[] = [
  { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard, group: "workspace", iconColor: "neutral" },
  { labelKey: "nav.projects", href: "/projects", icon: FolderKanban, group: "workspace", iconColor: "blue" },
  { labelKey: "nav.sessions", href: "/sessions", icon: TerminalSquare, group: "workspace", iconColor: "green" },
  { labelKey: "nav.copilot", href: "/copilot", icon: Bot, group: "workspace", iconColor: "red" },
  { labelKey: "nav.fleet", href: "/fleet", icon: Ship, group: "workspace", iconColor: "pink" },
  { labelKey: "nav.skills", href: "/skills", icon: Wrench, group: "resources", iconColor: "yellow" },
  { labelKey: "nav.templates", href: "/templates", icon: LayoutTemplate, group: "resources", iconColor: "orange" },
  { labelKey: "nav.models", href: "/models", icon: Brain, group: "resources", iconColor: "purple" },
  { labelKey: "nav.usage", href: "/usage", icon: BarChart3, group: "system", iconColor: "blue" },
  { labelKey: "nav.members", href: "/members", icon: UsersRound, group: "system", iconColor: "green" },
  { labelKey: "nav.notifications", href: "/notifications", icon: Bell, group: "system", iconColor: "pink" },
  { labelKey: "nav.settings", href: "/settings", icon: Settings, group: "system", iconColor: "neutral" },
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
        className="w-72 border-border/70 bg-popover/85 p-0 shadow-overlay backdrop-blur-xl backdrop-saturate-150"
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
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {t(notification.titleKey)}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {notification.message}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "justify-center px-2" : "px-2.5",
        active
          ? "bg-card/85 text-foreground shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08),inset_0_1px_0_hsl(var(--foreground)/0.04)] ring-1 ring-border/70"
          : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
      )}
    >
      {active && (
        <span className="absolute left-0 h-4 w-0.5 rounded-full bg-brand-accent" aria-hidden="true" />
      )}
      <item.icon
        strokeWidth={1.75}
        className={cn(
          "size-4 shrink-0 transition-transform duration-150 group-hover:scale-105",
          styles[item.iconColor]
        )}
      />
      <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>
        {t(item.labelKey)}
      </span>
      {showBadge && (
        <span
          className={cn(
            "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand-accent px-1 text-[10px] font-semibold text-brand-accent-foreground shadow-xs",
            collapsed && "absolute right-0.5 top-0.5 size-2 min-w-2 p-0 text-[0px]"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );

  const wrappedLink = collapsed ? (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-50 flex items-center gap-2 rounded-md border border-border/70 bg-popover/90 px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-raised backdrop-blur-xl backdrop-saturate-150"
        >
          <span>{t(item.labelKey)}</span>
          {showBadge ? (
            <span className="rounded-full bg-brand-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-brand-accent-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
          <Tooltip.Arrow className="fill-popover/90" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  ) : link;

  if (item.href !== "/notifications" || collapsed || !unreadPreview) {
    return wrappedLink;
  }
  return <UnreadPreviewPopover>{wrappedLink}</UnreadPreviewPopover>;
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
    <Tooltip.Provider delayDuration={150}>
      <nav className={cn(styles.navigation, "relative z-10 flex-1 overflow-y-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}>
        {groups.map((group, groupIndex) => (
          <div key={group.id} className={cn(groupIndex > 0 && "mt-3.5")}>
            {collapsed ? (
              groupIndex > 0 && <div className="mx-2 my-2 h-px bg-border/60" aria-hidden="true" />
            ) : (
              <div className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
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
    </Tooltip.Provider>
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
  const [shortcutHint, setShortcutHint] = useState<string | null>(null);

  useEffect(() => {
    const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    setShortcutHint(isApple ? "⌘B" : "Ctrl+B");
  }, []);

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";

  const collapseLabel = collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar");

  const CollapseButton = onToggleCollapse ? (
    <Tooltip.Provider delayDuration={180}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapseLabel}
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,border-color,color,transform] duration-150 outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-ring",
              collapsed
                ? "size-8 border border-border/60 bg-card/60 shadow-card hover:border-border hover:bg-card/90 hover:text-foreground"
                : "size-7 hover:bg-foreground/[0.06] hover:text-foreground"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen strokeWidth={1.75} className="size-4" />
            ) : (
              <PanelLeftClose strokeWidth={1.75} className="size-4" />
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={collapsed ? "right" : "bottom"}
            sideOffset={collapsed ? 10 : 6}
            className="z-50 flex items-center gap-2 rounded-md border border-border/70 bg-popover/90 px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-raised backdrop-blur-xl backdrop-saturate-150"
          >
            <span>{collapseLabel}</span>
            {shortcutHint ? (
              <kbd className="rounded border border-border/70 bg-muted/70 px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                {shortcutHint}
              </kbd>
            ) : null}
            <Tooltip.Arrow className="fill-popover/90" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ) : null;

  const MobileBrandHeader = (
    <div className="relative z-10 flex items-center gap-2.5 px-3 pb-3 select-none">
      <BrandMark className="shadow-card ring-1 ring-border/50" />
      <div className="min-w-0 text-[15px] font-semibold tracking-tight">ForgeBadger</div>
    </div>
  );

  const DesktopBrandHeader = (
    <div className="relative z-10 flex items-center justify-between gap-2 px-3 pb-3 select-none">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark className="shadow-card ring-1 ring-border/50" />
        <div className="min-w-0 truncate text-[15px] font-semibold tracking-tight">ForgeBadger</div>
      </div>
      {CollapseButton}
    </div>
  );

  const UserSection = (
    <div className="relative z-10 mt-auto border-t border-border/60 px-2 pt-2.5">
      <div className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-card/55 px-2 py-1.5 backdrop-blur-sm">
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

  const SidebarBackdropGlow = (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-16 -top-16 size-48 rounded-full bg-brand/10 blur-3xl dark:bg-brand/14" />
      <div className="absolute -bottom-20 -right-14 size-44 rounded-full bg-hue-iris/8 blur-3xl dark:bg-hue-iris/12" />
    </div>
  );

  return (
    <>
      {/* Mobile trigger */}
      <div className="fixed left-4 top-4 z-50 md:hidden" data-app-sidebar-trigger>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("nav.openNavigation")}
              className="border-border/70 bg-card/85 shadow-md backdrop-blur-xl backdrop-saturate-150"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[216px] overflow-hidden border-r border-border/70 bg-sidebar/85 p-0 backdrop-blur-xl backdrop-saturate-150"
          >
            <div className="relative flex h-full flex-col py-3">
              {SidebarBackdropGlow}
              <SheetTitle className="sr-only">{t("nav.sheetTitle")}</SheetTitle>
              {MobileBrandHeader}
              <NavLinks onNavigate={() => setOpen(false)} />
              {UserSection}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sidebar */}
      <aside
        data-app-sidebar
        className={cn(
          "group/sidebar relative hidden h-full flex-col border-r border-border/70 bg-sidebar/78 py-3 shadow-[inset_-1px_0_0_hsl(var(--foreground)/0.03)] backdrop-blur-xl backdrop-saturate-150 transition-[width] duration-200 ease-out md:flex",
          collapsed ? "w-[60px]" : "w-[200px]"
        )}
      >
        {SidebarBackdropGlow}
        {collapsed ? (
          <>
            <div className="relative z-10 flex flex-col items-center gap-2 px-2 pb-1">
              <BrandMark className="shadow-card ring-1 ring-border/50" />
              {CollapseButton}
            </div>
            <div className="relative z-10 mx-3 my-1.5 h-px bg-border/60" aria-hidden="true" />
            <NavLinks collapsed />
            <div className="relative z-10 mt-auto flex flex-col items-center gap-2.5 border-t border-border/60 px-2 pt-3">
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
            {DesktopBrandHeader}
            <NavLinks unreadPreview />
            {UserSection}
          </>
        )}
      </aside>
    </>
  );
}
