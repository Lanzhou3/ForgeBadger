"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Trash2, Users } from "lucide-react";

import { AdapterSelect } from "@/components/adapter-select";
import { runtimeSettingsQueryKey } from "@/components/settings/InstanceRuntimeSettings";
import { SettingsCardHeader } from "@/components/settings/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import {
  getRuntimeSettings,
  runtimeSettingsValue,
  updateRuntimeSettings,
  type CopilotTeamAdapter,
  type CopilotTeamMember,
  type CopilotTeamRole,
  type CopilotTeamRoster,
} from "@/lib/api";
import { toast } from "@/lib/toast";
import { useSettingsCopy } from "./settings-copy";

const MAX_MEMBERS = 12;
const NAME_MAX = 40;
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 500;
const DEFAULT_PARALLEL = 3;

const ADAPTER_LABELS: Record<CopilotTeamAdapter, string> = {
  claude: "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
  kimi: "Kimi Code",
  pi: "Pi",
  mcode: "MiniMax Code",
  grok: "Grok",
};

const EMPTY_ROSTER: CopilotTeamRoster = { maxParallelWriters: DEFAULT_PARALLEL, members: [] };

function generateMemberId(adapter: CopilotTeamAdapter, taken: ReadonlySet<string>): string {
  for (;;) {
    const suffix = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
    const id = `${adapter}-${suffix}`;
    if (!taken.has(id)) return id;
  }
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error && error.message ? error.message : null;
}

interface FormState {
  /** null → creating a new member. */
  id: string | null;
  member: CopilotTeamMember;
}

/**
 * Team roster card (Copilot settings → general): the AI coding CLIs the
 * Copilot may dispatch goal tasks to. The roster is edited as a whole and
 * saved explicitly. Admin-only (the API enforces the same boundary).
 */
export function CopilotTeamPanel() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const copy = useSettingsCopy();
  const queryClient = useQueryClient();
  const [roster, setRoster] = useState<CopilotTeamRoster>(EMPTY_ROSTER);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);

  const settings = useQuery({
    queryKey: runtimeSettingsQueryKey,
    queryFn: getRuntimeSettings,
    retry: false,
    enabled: user?.role === "admin",
  });

  // Sync on this card's own value only (stable JSON): other cards save through
  // the same query, and that must not discard unsaved edits here.
  const savedJson = useMemo(() => {
    if (!settings.data) return undefined;
    const saved = runtimeSettingsValue<CopilotTeamRoster>(settings.data, "copilot_team") ?? EMPTY_ROSTER;
    return JSON.stringify(saved);
  }, [settings.data]);
  useEffect(() => {
    if (savedJson === undefined) return;
    setRoster(JSON.parse(savedJson) as CopilotTeamRoster);
    setDirty(false);
    setForm(null);
  }, [savedJson]);

  const save = useMutation({
    mutationFn: () => updateRuntimeSettings({ copilot_team: roster }),
    onSuccess: (state) => {
      queryClient.setQueryData(runtimeSettingsQueryKey, state);
      setDirty(false);
      toast.success(copy.teamSaved);
    },
    onError: (error) => toast.error(errorMessage(error) ?? copy.teamSaveError),
  });

  if (user?.role !== "admin") return null;

  const readonly = settings.data?.readonly ?? false;
  const dispatchSupport = settings.data?.capabilities?.programmaticDispatch;
  const parallelValid =
    Number.isInteger(roster.maxParallelWriters) && roster.maxParallelWriters >= 1 && roster.maxParallelWriters <= 6;

  const update = (next: CopilotTeamRoster) => {
    setRoster(next);
    setDirty(true);
  };

  const openCreate = () => {
    setForm({
      id: null,
      member: { id: "", name: "", title: "", description: "", adapter: "claude", roles: ["writer"], enabled: true },
    });
  };

  const commitForm = (member: CopilotTeamMember) => {
    if (form?.id) {
      update({ ...roster, members: roster.members.map((m) => (m.id === form.id ? { ...member, id: form.id } : m)) });
    } else {
      const id = generateMemberId(member.adapter, new Set(roster.members.map((m) => m.id)));
      update({ ...roster, members: [...roster.members, { ...member, id }] });
    }
    setForm(null);
  };

  const atMax = roster.members.length >= MAX_MEMBERS;

  return (
    <Card className="forgebadger-animate-in" style={{ animationDelay: "210ms" }}>
      <SettingsCardHeader
        icon={<Users className="size-4" />}
        title={copy.teamTitle}
        description={copy.teamDescription}
        action={
          readonly ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3" />
              {copy.autonomySourceEnv}
            </Badge>
          ) : null
        }
      />
      <CardContent className="space-y-3">
        {settings.isError ? (
          <div className="flex items-center gap-3 text-xs text-destructive">
            {copy.autonomyLoadError}
            <Button type="button" variant="ghost" size="sm" className="h-6" onClick={() => void settings.refetch()}>
              {copy.autonomyRetry}
            </Button>
          </div>
        ) : settings.isLoading ? (
          <p className="text-xs text-muted-foreground">…</p>
        ) : (
          <>
            {readonly && (
              <p className="rounded-md border border-border/70 bg-muted/20 p-2 text-xs text-muted-foreground">
                {copy.autonomyReadonly}
              </p>
            )}
            {roster.members.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                {copy.teamEmpty}
              </p>
            ) : (
              <ul className="space-y-2">
                {roster.members.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    readonly={readonly}
                    manualOnly={dispatchSupport?.[member.adapter] === false}
                    onToggle={(enabled) =>
                      update({
                        ...roster,
                        members: roster.members.map((m) => (m.id === member.id ? { ...m, enabled } : m)),
                      })
                    }
                    onEdit={() => setForm({ id: member.id, member })}
                    onRemove={() => update({ ...roster, members: roster.members.filter((m) => m.id !== member.id) })}
                  />
                ))}
              </ul>
            )}
            {form ? (
              <MemberForm
                key={form.id ?? "new"}
                initial={form.member}
                isNew={form.id === null}
                onCancel={() => setForm(null)}
                onCommit={commitForm}
              />
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  disabled={readonly || atMax}
                  onClick={openCreate}
                >
                  <Plus className="size-3.5" />
                  {copy.teamAdd}
                </Button>
                {atMax && <span className="text-xs text-muted-foreground">{copy.teamMaxReached}</span>}
              </div>
            )}
            <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-3">
              <div className="min-w-0">
                <Label htmlFor="team-parallel-writers" className="text-sm font-medium">
                  {copy.teamParallelWriters}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{copy.teamParallelWritersDescription}</p>
              </div>
              <Input
                id="team-parallel-writers"
                type="number"
                min={1}
                max={6}
                step={1}
                className="h-8 w-16 shrink-0"
                value={Number.isNaN(roster.maxParallelWriters) ? "" : roster.maxParallelWriters}
                disabled={readonly}
                aria-invalid={!parallelValid}
                onChange={(event) => update({ ...roster, maxParallelWriters: event.target.valueAsNumber })}
              />
            </div>
            {/* Sticky footer matches the autonomy panel (Card py-6 padding). */}
            <div className="sticky -bottom-6 z-10 -mx-6 flex justify-end border-t border-border/70 bg-card/95 px-6 py-2.5 backdrop-blur-sm">
              <Button
                size="sm"
                className="h-8"
                disabled={readonly || !dirty || !parallelValid || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? copy.autonomySaving : t("common.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface MemberRowProps {
  member: CopilotTeamMember;
  readonly: boolean;
  manualOnly: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
}

function MemberRow({ member, readonly, manualOnly, onToggle, onEdit, onRemove }: MemberRowProps) {
  const copy = useSettingsCopy();
  return (
    <li className="rounded-md border border-border/70 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{member.name}</span>
            {member.title && <span className="text-xs text-muted-foreground">{member.title}</span>}
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              {ADAPTER_LABELS[member.adapter]}
            </Badge>
            {member.roles.map((role) => (
              <Badge key={role} variant="secondary" className="h-4 px-1.5 text-[10px]">
                {role === "writer" ? copy.teamRoleWriter : copy.teamRoleReviewer}
              </Badge>
            ))}
          </div>
          {member.description && <p className="truncate text-xs text-muted-foreground">{member.description}</p>}
          {manualOnly && (
            <p role="note" className="text-xs text-muted-foreground">
              {copy.teamManualOnly}
            </p>
          )}
        </div>
        <Switch
          checked={member.enabled}
          disabled={readonly}
          onCheckedChange={onToggle}
          aria-label={`${copy.teamEnabled} ${member.name}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={readonly}
          aria-label={`${copy.teamEdit} ${member.name}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={readonly}
          aria-label={`${copy.teamRemove} ${member.name}`}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

interface MemberFormProps {
  initial: CopilotTeamMember;
  isNew: boolean;
  onCancel: () => void;
  onCommit: (member: CopilotTeamMember) => void;
}

function MemberForm({ initial, isNew, onCancel, onCommit }: MemberFormProps) {
  const copy = useSettingsCopy();
  const [draft, setDraft] = useState<CopilotTeamMember>(initial);
  const patch = (next: Partial<CopilotTeamMember>) => setDraft((d) => ({ ...d, ...next }));
  const toggleRole = (role: CopilotTeamRole, on: boolean) =>
    patch({ roles: on ? [...draft.roles.filter((r) => r !== role), role] : draft.roles.filter((r) => r !== role) });

  const name = draft.name.trim();
  const nameError = name.length === 0 ? copy.teamNameRequired : name.length > NAME_MAX ? copy.teamFieldTooLong(NAME_MAX) : null;
  const titleError = draft.title.trim().length > TITLE_MAX ? copy.teamFieldTooLong(TITLE_MAX) : null;
  const descriptionError = draft.description.trim().length > DESCRIPTION_MAX ? copy.teamFieldTooLong(DESCRIPTION_MAX) : null;
  const rolesError = draft.roles.length === 0 ? copy.teamRoleRequired : null;
  const invalid = Boolean(nameError || titleError || descriptionError || rolesError);

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <p className="text-sm font-medium">{isNew ? copy.teamFormAdd : copy.teamFormEdit}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="team-member-name" className="text-xs">{copy.teamName}</Label>
          <Input
            id="team-member-name"
            className="h-8"
            value={draft.name}
            maxLength={NAME_MAX}
            placeholder={copy.teamNameHint}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="team-member-title" className="text-xs">{copy.teamTitleField}</Label>
          <Input
            id="team-member-title"
            className="h-8"
            value={draft.title}
            maxLength={TITLE_MAX}
            placeholder={copy.teamTitleHint}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="team-member-description" className="text-xs">{copy.teamDescriptionField}</Label>
        <Textarea
          id="team-member-description"
          rows={3}
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          placeholder={copy.teamDescriptionHint}
          onChange={(e) => patch({ description: e.target.value })}
        />
        <p className="text-right text-[10px] text-muted-foreground">
          {draft.description.length}/{DESCRIPTION_MAX}
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="team-member-cli" className="text-xs">{copy.teamCli}</Label>
        <AdapterSelect
          id="team-member-cli"
          ariaLabel={copy.teamCli}
          size="sm"
          value={draft.adapter}
          onValueChange={(adapter) => patch({ adapter })}
        />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">{copy.teamRoles}</legend>
        <div className="flex flex-wrap gap-4">
          {(["writer", "reviewer"] as const).map((role) => (
            <label key={role} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={draft.roles.includes(role)}
                onCheckedChange={(checked) => toggleRole(role, checked === true)}
              />
              {role === "writer" ? copy.teamRoleWriter : copy.teamRoleReviewer}
            </label>
          ))}
        </div>
        {rolesError && <p className="text-xs text-destructive">{rolesError}</p>}
      </fieldset>
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={draft.enabled} onCheckedChange={(enabled) => patch({ enabled })} aria-label={copy.teamEnabled} />
        {copy.teamEnabled}
      </label>
      {(titleError || descriptionError) && (
        <p className="text-xs text-destructive">{titleError ?? descriptionError}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onCancel}>
          {copy.teamFormCancel}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={invalid}
          onClick={() =>
            onCommit({ ...draft, name, title: draft.title.trim(), description: draft.description.trim() })
          }
        >
          {copy.teamFormDone}
        </Button>
      </div>
    </div>
  );
}
