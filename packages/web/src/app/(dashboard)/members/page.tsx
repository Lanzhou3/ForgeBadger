"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { AccountMembers } from "@/components/members/AccountMembers";
import { MemberCollaboration } from "@/components/members/MemberCollaboration";
import { ProjectAccess } from "@/components/members/ProjectAccess";
import { cn } from "@/lib/utils";
export default function MembersPage() {
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const search = useSearchParams();
  if (isLoading || !user) return <main className="p-6" role="status">{t("common.loading")}</main>;
  const isAdmin = user.role === "admin";
  const requested = search.get("project") ? "projects" : search.get("team") ? "collaboration" : search.get("view");
  const view = requested === "projects" || requested === "collaboration" ? requested : isAdmin ? "accounts" : "collaboration";
  const tabs = [...(isAdmin ? ["accounts"] as const : []), "collaboration", "projects"] as const;
  return <main className="mx-auto max-w-6xl space-y-5 p-4 pt-16 md:p-6">
    <header>
      <h1 className="text-xl font-semibold">{t("members.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("membersHub.intro")}</p>
    </header>
    <nav aria-label={t("members.title")} className="flex flex-wrap gap-1 border-b border-border pb-2">
      {tabs.map(tab => <Link key={tab} href={`/members?view=${tab}`} aria-current={view === tab ? "page" : undefined} className={cn("rounded-md px-3 py-2 text-sm", view === tab ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50")}>{t(`membersHub.${tab}`)}</Link>)}
    </nav>
    {view === "accounts" && isAdmin && <AccountMembers key={user.id} />}
    {view === "collaboration" && <MemberCollaboration key={user.id} selectedTeamId={search.get("team")} />}
    {view === "projects" && <ProjectAccess key={user.id} projectId={search.get("project")} />}
  </main>;
}
