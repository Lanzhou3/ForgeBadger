"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

export function SkillNavigation() {
  const path = usePathname();
  const { language } = useLanguage();
  const en = language === "en";
  return (
    <nav
      aria-label={en ? "Skill navigation" : "Skill 导航"}
      className="flex gap-1 border-b border-border"
    >
      {[
        { href: "/skills", label: en ? "Installed" : "已安装" },
        { href: "/skills/discover", label: en ? "Discover" : "发现" },
        { href: "/skills/sources", label: en ? "Sources" : "来源管理" },
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
