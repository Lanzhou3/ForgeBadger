"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrilingual } from "@/hooks/use-trilingual";
import { cn } from "@/lib/utils";

export function SkillNavigation() {
  const path = usePathname();
  const pick = useTrilingual();
  return (
    <nav
      aria-label={pick("Skill 导航", "Skill 導覽", "Skill navigation")}
      className="flex flex-nowrap gap-6 overflow-x-auto border-b border-border"
    >
      {[
        {
          href: "/skills",
          label: pick("我的 Skills", "我的 Skills", "My Skills"),
        },
        { href: "/skills/discover", label: pick("发现", "探索", "Discover") },
        {
          href: "/skills/sources",
          label: pick("来源管理", "來源管理", "Sources"),
        },
      ].map((item) => {
        const active =
          path === item.href ||
          (path === "/skills/install" && item.href.endsWith("discover"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              active && "border-brand text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
