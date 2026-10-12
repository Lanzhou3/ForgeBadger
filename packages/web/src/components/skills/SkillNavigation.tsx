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
      className="flex gap-1 border-b border-border"
    >
      {[
        { href: "/skills", label: pick("已安装", "已安裝", "Installed") },
        { href: "/skills/discover", label: pick("发现", "發現", "Discover") },
        { href: "/skills/sources", label: pick("来源管理", "來源管理", "Sources") },
      ].map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={
            path === item.href ||
            (path === "/skills/install" && item.href.endsWith("discover"))
              ? "page"
              : undefined
          }
          className={cn(
            "border-b-2 border-transparent px-4 py-3 text-sm text-muted-foreground hover:text-foreground",
            (path === item.href ||
              (path === "/skills/install" && item.href.endsWith("discover"))) &&
              "border-brand text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
