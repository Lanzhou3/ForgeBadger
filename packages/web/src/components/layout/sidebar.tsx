"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FolderOpen,
  TerminalSquare,
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { useNotifications } from "@/hooks/use-notifications";
import type { TranslationKey } from "@/lib/i18n";

export const navItems = [
  { labelKey: "nav.dashboard", href: "/", icon: LayoutDashboard },
  { labelKey: "nav.projects", href: "/projects", icon: FolderOpen },
  { labelKey: "nav.sessions", href: "/sessions", icon: TerminalSquare },
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

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { unreadCount } = useNotifications();
  const { user } = useAuth();
  const visibleItems = navItems.filter((item) => !item.adminOnly || user?.role === "admin");
  return (
    <nav className="flex flex-col gap-1 px-2">
      {visibleItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <item.icon className="size-4" />
            <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
            {item.href === "/notifications" && unreadCount > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 justify-center px-1 text-[10px]">
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Link>
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
            <Button variant="outline" size="icon">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[220px] p-0">
            <div className="flex h-full flex-col py-4">
              <div className="mb-4 px-4 text-lg font-semibold tracking-tight">
                OpenForge
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
              {UserSection}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop sidebar */}
      <aside className={cn("hidden h-full w-[220px] flex-col border-r border-border bg-background md:flex", collapsed && "md:hidden")}>
        <div className="px-4 py-4 text-lg font-semibold tracking-tight">
          OpenForge
        </div>
        <NavLinks />
        {UserSection}
      </aside>
    </>
  );
}
