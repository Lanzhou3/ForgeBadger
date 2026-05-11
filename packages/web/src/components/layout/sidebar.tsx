"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FolderOpen,
  TerminalSquare,
  Sparkles,
  Bot,
  Wrench,
  Puzzle,
  FileCode2,
  Brain,
  BarChart3,
  History,
  Settings,
  Bell,
  Menu,
  LogOut,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { brandAssets } from "@/lib/brand-assets";
import { useNotifications } from "@/hooks/use-notifications";
import type { TranslationKey } from "@/lib/i18n";

export const navItems = [
  { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
  { labelKey: "nav.projects", href: "/projects", icon: FolderOpen },
  { labelKey: "nav.sessions", href: "/sessions", icon: TerminalSquare },
  { labelKey: "nav.copilot", href: "/copilot", icon: Sparkles },
  { labelKey: "nav.agents", href: "/agents", icon: Bot },
  { labelKey: "nav.skills", href: "/skills", icon: Wrench },
  { labelKey: "nav.plugins", href: "/plugins", icon: Puzzle },
  { labelKey: "nav.templates", href: "/templates", icon: FileCode2 },
  { labelKey: "nav.models", href: "/models", icon: Brain },
  { labelKey: "nav.usage", href: "/usage", icon: BarChart3 },
  { labelKey: "nav.history", href: "/history", icon: History },
  { labelKey: "nav.members", href: "/members", icon: UsersRound, adminOnly: true },
  { labelKey: "nav.notifications", href: "/notifications", icon: Bell },
  { labelKey: "nav.settings", href: "/settings", icon: Settings },
] satisfies Array<{ labelKey: TranslationKey; href: string; icon: LucideIcon; adminOnly?: boolean }>;

function NavLinks({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const visibleItems = navItems.filter((item) => !item.adminOnly || user?.role === "admin");
  return (
    <nav className="flex flex-col gap-1 px-2">
      {visibleItems.map((item, index) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const showSeparator = [4, 9].includes(index);
        return (
          <div key={item.href}>
            {showSeparator && <div className="mx-3 my-2 h-px bg-border/70" aria-hidden="true" />}
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-label={collapsed ? t(item.labelKey) : undefined}
              title={collapsed ? t(item.labelKey) : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
                isActive
                  ? "bg-white/[0.04] text-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-brand"
                  : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"
              )}
            >
              <item.icon className={cn("size-4", isActive && "text-brand")} />
              <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>
                {t(item.labelKey)}
              </span>
              {item.href === "/notifications" && unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className={cn(
                    "h-5 min-w-5 justify-center px-1 text-[10px]",
                    collapsed && "absolute right-1 top-1 h-2 min-w-2 rounded-full p-0 text-[0px]"
                  )}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </Badge>
              )}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";

  const BrandHeader = (
    <div className="mb-4 flex items-center gap-3 px-4">
      <div className="flex size-9 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04]">
        <img
          src={brandAssets.logoSvg}
          alt=""
          className="size-6"
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0 text-lg font-semibold tracking-tight">
        OpenForge
      </div>
    </div>
  );

  const UserSection = (
    <div className="mt-auto border-t border-border p-4">
      <div className="flex items-center gap-3">
        <Avatar size="sm">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {user?.email ?? t("nav.guest")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => logout()}
          aria-label={t("nav.logout")}
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </div>
  );

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
          <SheetContent side="left" className="w-[220px] p-0">
            <div className="flex h-full flex-col py-4">
              <SheetTitle className="sr-only">OpenForge navigation</SheetTitle>
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
          "hidden h-full flex-col border-r border-border bg-[#070a0e] py-4 md:flex",
          collapsed ? "w-[60px]" : "w-[220px]"
        )}
      >
        {collapsed ? (
          <>
            <div className="mb-4 flex justify-center px-2">
              <div className="flex size-9 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04]">
                <img
                  src={brandAssets.logoSvg}
                  alt=""
                  className="size-6"
                  aria-hidden="true"
                />
              </div>
            </div>
            <NavLinks collapsed />
            <div className="mt-auto flex flex-col items-center gap-3 border-t border-border px-2 pt-4">
              <Avatar size="sm">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => logout()}
                aria-label={t("nav.logout")}
                title={t("nav.logout")}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            {BrandHeader}
            <NavLinks />
            {UserSection}
          </>
        )}
      </aside>
    </>
  );
}
