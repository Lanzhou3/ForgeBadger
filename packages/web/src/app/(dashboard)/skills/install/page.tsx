"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Github, PackagePlus, Sparkles, Store } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  installCatalogSkill,
  installGitHubSkill,
  installSkill,
  listCatalogItems,
  listSkillSources,
  previewGitHubSkillSource,
  previewSkillSource,
  refreshMarketplace,
  type GitHubSkillSourcePreview,
  type RemoteSkillPreview
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import Link from "next/link";

const MARKETPLACE_SEEDS = [
  "anthropics/claude-plugins-official",
  "anthropics/skills",
  "anthropics/claude-plugins-community",
];

export default function SkillInstallPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sourceId, setSourceId] = useState("local");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [sourceUrl, setSourceUrl] = useState("");
  const [remotePreview, setRemotePreview] = useState<RemoteSkillPreview | null>(null);
  const [previewedSourceUrl, setPreviewedSourceUrl] = useState("");
  const [error, setError] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubRef, setGithubRef] = useState("");
  const [githubPreview, setGithubPreview] = useState<GitHubSkillSourcePreview | null>(null);
  const [githubPreviewedRepo, setGithubPreviewedRepo] = useState("");
  const [githubSelectedPath, setGithubSelectedPath] = useState<string | null>(null);
  const [githubError, setGithubError] = useState("");
  const [marketplaceRepo, setMarketplaceRepo] = useState("");
  const [marketplaceResult, setMarketplaceResult] = useState<{ items: number; skipped: number } | null>(null);
  const [marketplaceError, setMarketplaceError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["skill-sources"],
    queryFn: listSkillSources,
  });
  const { data: catalogItemsData } = useQuery({
    queryKey: ["catalog-items"],
    queryFn: listCatalogItems,
  });

  const sources = data?.sources ?? [];
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === sourceId) ?? sources[0],
    [sourceId, sources]
  );
  const isRemoteSource = selectedSource?.id === "github" || selectedSource?.id === "clawhub";

  const installMutation = useMutation({
    mutationFn: () =>
      installSkill({
        sourceId: selectedSource?.id ?? sourceId,
        name: name.trim(),
        description: description.trim() || undefined,
        version: version.trim() || undefined,
        ...(isRemoteSource && remotePreview
          ? {
              url: sourceUrl.trim(),
              skillId: remotePreview.provenance.skillId,
            }
          : {}),
      }),
    onSuccess: () => {
      setError("");
      router.push("/skills");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("skills.installFailed"));
    },
  });
  const catalogInstallMutation = useMutation({
    mutationFn: installCatalogSkill,
    onSuccess: () => {
      setError("");
      router.push("/skills");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("skills.installFailed"));
    },
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      previewSkillSource({
        sourceId: selectedSource?.id ?? sourceId,
        url: sourceUrl.trim(),
      }),
    onSuccess: ({ preview }) => {
      setError("");
      setRemotePreview(preview);
      setPreviewedSourceUrl(sourceUrl.trim());
      setName(preview.name);
      setDescription(preview.description ?? "");
      setVersion(preview.version);
    },
    onError: (err) => {
      setRemotePreview(null);
      setPreviewedSourceUrl("");
      setError(err instanceof Error ? err.message : t("skills.installFailed"));
    },
  });
  const githubPreviewMutation = useMutation({
    mutationFn: () =>
      previewGitHubSkillSource({
        repo: githubRepo.trim(),
        ...(githubRef.trim() ? { ref: githubRef.trim() } : {}),
      }),
    onSuccess: (preview) => {
      setGithubError("");
      setGithubPreview(preview);
      setGithubPreviewedRepo(preview.repo ?? githubRepo.trim());
      setGithubSelectedPath(preview.skills[0]?.path ?? null);
    },
    onError: (err) => {
      setGithubPreview(null);
      setGithubPreviewedRepo("");
      setGithubSelectedPath(null);
      setGithubError(err instanceof Error ? err.message : t("skills.installFailed"));
    },
  });
  const githubInstallMutation = useMutation({
    mutationFn: (path: string) =>
      installGitHubSkill({
        repo: githubPreviewedRepo,
        ...(githubRef.trim() ? { ref: githubRef.trim() } : {}),
        path,
      }),
    onSuccess: () => {
      setGithubError("");
      router.push("/skills");
    },
    onError: (err) => {
      setGithubError(err instanceof Error ? err.message : t("skills.installFailed"));
    },
  });
  const marketplaceMutation = useMutation({
    mutationFn: (repo: string) => refreshMarketplace({ repo }),
    onSuccess: (result) => {
      setMarketplaceError("");
      setMarketplaceResult({ items: result.items.length, skipped: result.skipped?.length ?? 0 });
      setMarketplaceRepo("");
      queryClient.invalidateQueries({ queryKey: ["catalog-items"] });
      queryClient.invalidateQueries({ queryKey: ["catalog-sources"] });
    },
    onError: (err) => {
      setMarketplaceResult(null);
      setMarketplaceError(err instanceof Error ? err.message : t("skills.installFailed"));
    },
  });
  const catalogSkills = (catalogItemsData?.items ?? []).filter((item) => item.itemType === "skill");
  const remotePreviewRequired = isRemoteSource && (!remotePreview || previewedSourceUrl !== sourceUrl.trim());

  function selectSource(nextSourceId: string) {
    setSourceId(nextSourceId);
    setRemotePreview(null);
    setPreviewedSourceUrl("");
    setError("");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("skills.install")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("skills.installSubtitle")}</p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/skills">
            <ArrowLeft className="size-4" />
            {t("common.back")}
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="forgebadger-animate-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("skills.sourceCatalog")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {sources.map((source, index) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => selectSource(source.id)}
                    style={{ animationDelay: `${index * 40}ms` }}
                    className={[
                      "rounded-md border p-4 text-left transition-all duration-200 forgebadger-animate-in",
                      sourceId === source.id
                        ? "border-brand/50 bg-brand/5"
                        : "border-border bg-background hover:-translate-y-0.5 hover:border-brand/30 hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{source.label}</h3>
                      <Badge variant="outline">{source.installMode}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {source.description}
                    </p>
                  </button>
                ))}
              </div>
            )}

            <div className="rounded-md border border-border/70 bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-brand" />
                {t("skills.selectSource")}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {selectedSource?.description ?? t("common.loading")}
              </p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-md border border-border/70 bg-background p-3 text-xs">
                {selectedSource?.starterContent ?? ""}
              </pre>
            </div>

            <div className="rounded-md border border-border/70 bg-background p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{t("skills.catalogInstall")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("skills.catalogInstallDescription")}
                  </p>
                </div>
              </div>
              {catalogSkills.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("skills.catalogEmpty")}</p>
              ) : (
                <div className="space-y-2">
                  {catalogSkills.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-md border border-border/70 px-3 py-2.5 transition-colors hover:bg-muted/40 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.name}</div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.description ?? item.externalId}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => catalogInstallMutation.mutate(item.id)}
                        disabled={catalogInstallMutation.isPending}
                      >
                        {catalogInstallMutation.isPending
                          ? t("skills.installing")
                          : t("skills.installCatalogItem")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="forgebadger-animate-in">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("skills.installSkill")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="skill-install-name">{t("common.name")}</Label>
              <Input
                id="skill-install-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="review-workflow"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-install-description">{t("common.description")}</Label>
              <Input
                id="skill-install-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Review pull requests with a consistent checklist."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-install-version">{t("skills.version")}</Label>
              <Input
                id="skill-install-version"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("skills.installSource")}</Label>
              <div className="flex flex-wrap gap-2">
                {sources.map((source) => (
                  <Button
                    key={source.id}
                    type="button"
                    variant={sourceId === source.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => selectSource(source.id)}
                  >
                    {source.label}
                  </Button>
                ))}
              </div>
            </div>
            {isRemoteSource && (
              <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="space-y-2">
                  <Label htmlFor="skill-source-url">{t("skills.remoteUrl")}</Label>
                  <Input
                    id="skill-source-url"
                    value={sourceUrl}
                    onChange={(event) => {
                      setSourceUrl(event.target.value);
                      setRemotePreview(null);
                      setPreviewedSourceUrl("");
                    }}
                    placeholder="https://raw.githubusercontent.com/org/repo/main/SKILL.md"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={!sourceUrl.trim() || previewMutation.isPending}
                  onClick={() => previewMutation.mutate()}
                >
                  <Eye className="size-4" />
                  {previewMutation.isPending ? t("skills.previewingSource") : t("skills.previewSource")}
                </Button>
                {remotePreview && (
                  <div className="rounded-md border border-border/70 bg-background p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t("skills.remotePreviewTitle")}</span>
                      <Badge variant="outline">{remotePreview.provenance.kind}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("skills.remotePreviewProvenance")}: {remotePreview.provenance.url}
                    </p>
                    <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
                      {remotePreview.content}
                    </pre>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t("skills.installedDisabledHint")}</p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              size="sm"
              className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
              onClick={() => installMutation.mutate()}
              disabled={installMutation.isPending || !name.trim() || remotePreviewRequired}
            >
              <PackagePlus className="size-4" />
              {installMutation.isPending ? t("skills.installing") : t("skills.installSkill")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="forgebadger-animate-in">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Github className="size-4" />
              {t("skills.githubRepoTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("skills.githubRepoDescription")}</p>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="skill-github-repo">{t("skills.githubRepoInput")}</Label>
                <Input
                  id="skill-github-repo"
                  value={githubRepo}
                  onChange={(event) => {
                    setGithubRepo(event.target.value);
                    setGithubPreview(null);
                    setGithubPreviewedRepo("");
                    setGithubSelectedPath(null);
                  }}
                  placeholder="owner/repo[/path]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="skill-github-ref">{t("skills.githubRefInput")}</Label>
                <Input
                  id="skill-github-ref"
                  value={githubRef}
                  onChange={(event) => setGithubRef(event.target.value)}
                  placeholder="main"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!githubRepo.trim() || githubPreviewMutation.isPending}
              onClick={() => githubPreviewMutation.mutate()}
            >
              <Eye className="size-4" />
              {githubPreviewMutation.isPending ? t("skills.githubPreviewing") : t("skills.githubPreview")}
            </Button>
            {githubPreview && (
              <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{t("skills.githubSelectSkill")}</span>
                  <Badge variant="outline">{githubPreview.sha.slice(0, 7)}</Badge>
                </div>
                {githubPreview.skills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("skills.githubNoSkills")}</p>
                ) : (
                  <div className="space-y-2">
                    {githubPreview.skills.map((skill) => (
                      <button
                        key={skill.path}
                        type="button"
                        onClick={() => setGithubSelectedPath(skill.path)}
                        className={[
                          "w-full rounded-md border px-3 py-2 text-left transition-colors",
                          githubSelectedPath === skill.path
                            ? "border-brand/50 bg-brand/5"
                            : "border-border/70 bg-background hover:bg-muted/40",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{skill.name}</span>
                          {skill.version && <Badge variant="outline">{skill.version}</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {skill.description ?? skill.path}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
                  disabled={!githubSelectedPath || githubInstallMutation.isPending}
                  onClick={() => {
                    if (githubSelectedPath) githubInstallMutation.mutate(githubSelectedPath);
                  }}
                >
                  <PackagePlus className="size-4" />
                  {githubInstallMutation.isPending ? t("skills.installing") : t("skills.githubInstallSelected")}
                </Button>
              </div>
            )}
            {githubError && <p className="text-sm text-destructive">{githubError}</p>}
            <p className="text-xs text-muted-foreground">{t("skills.githubRepoHint")}</p>
          </CardContent>
        </Card>

        <Card className="forgebadger-animate-in">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4" />
              {t("skills.marketplacesTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("skills.marketplacesDescription")}</p>
            <div className="space-y-2">
              <Label>{t("skills.marketplaceSeeds")}</Label>
              <div className="flex flex-wrap gap-2">
                {MARKETPLACE_SEEDS.map((repo) => (
                  <Button
                    key={repo}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={marketplaceMutation.isPending}
                    onClick={() => marketplaceMutation.mutate(repo)}
                  >
                    {repo}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-marketplace-repo">{t("skills.marketplaceCustomRepo")}</Label>
              <div className="flex gap-2">
                <Input
                  id="skill-marketplace-repo"
                  value={marketplaceRepo}
                  onChange={(event) => setMarketplaceRepo(event.target.value)}
                  placeholder="owner/repo"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!marketplaceRepo.trim() || marketplaceMutation.isPending}
                  onClick={() => marketplaceMutation.mutate(marketplaceRepo.trim())}
                >
                  {marketplaceMutation.isPending ? t("skills.marketplaceRefreshing") : t("skills.marketplaceAdd")}
                </Button>
              </div>
            </div>
            {marketplaceResult && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">
                  {t("skills.marketplaceItemsRefreshed").replace("{count}", String(marketplaceResult.items))}
                </Badge>
                {marketplaceResult.skipped > 0 && (
                  <Badge variant="outline">
                    {t("skills.marketplaceSkipped").replace("{count}", String(marketplaceResult.skipped))}
                  </Badge>
                )}
              </div>
            )}
            {marketplaceError && <p className="text-sm text-destructive">{marketplaceError}</p>}
            <p className="text-xs text-muted-foreground">{t("skills.marketplaceHint")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
