import { type FormEvent } from "react";
import { Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ModelProfile } from "@/lib/api";

import {
  COMMON_MODEL_CAPABILITIES,
  EmptyLine,
  type ModelForm,
  type Translate,
} from "./shared";

interface ModelsTabProps {
  models: ModelProfile[];
  selectedModelId: string;
  modelForm: ModelForm;
  dialogOpen: boolean;
  isSaving: boolean;
  isSettingDefault: boolean;
  isDeleting: boolean;
  isSyncing: boolean;
  syncDisabled: boolean;
  onSync: () => void;
  onModelFormChange: (form: ModelForm) => void;
  onDialogOpenChange: (open: boolean) => void;
  onNewModel: () => void;
  onEditModel: (modelId: string) => void;
  onSetDefault: (modelId: string) => void;
  onDeleteModel: (modelId: string) => void;
  onSubmitModel: (event: FormEvent<HTMLFormElement>) => void;
  t: Translate;
}

export function ModelsTab({
  models,
  selectedModelId,
  modelForm,
  dialogOpen,
  isSaving,
  isSettingDefault,
  isDeleting,
  isSyncing,
  syncDisabled,
  onSync,
  onModelFormChange,
  onDialogOpenChange,
  onNewModel,
  onEditModel,
  onSetDefault,
  onDeleteModel,
  onSubmitModel,
  t,
}: ModelsTabProps) {
  function toggleCapability(capability: string) {
    const next = modelForm.capabilities.includes(capability)
      ? modelForm.capabilities.filter((item) => item !== capability)
      : [...modelForm.capabilities, capability];
    onModelFormChange({ ...modelForm, capabilities: next });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t("models.modelsWorkspaceDescription")}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={syncDisabled || isSyncing}
            title={syncDisabled ? t("models.syncRequiresCredential") : t("models.syncProviderModelsDescription")}
            onClick={onSync}
          >
            <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
            {t("models.syncProviderModels")}
          </Button>
          {syncDisabled && (
            <span className="text-xs text-muted-foreground">{t("models.syncRequiresCredential")}</span>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onNewModel}>
            <Plus className="size-4" />
            {t("models.newModel")}
          </Button>
        </div>
      </div>

      {models.length === 0 ? (
        <EmptyLine text={t("models.emptyModelsForProvider")} />
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {models.map((model, index) => {
            return (
              <div
                key={model.id}
                className={`flex items-center gap-3 px-4 py-3 transition-colors forgebadger-animate-in hover:bg-muted/40 ${
                  model.id === selectedModelId ? "bg-brand/5" : ""
                }`}
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{model.name}</span>
                    {model.isDefault && <Badge className="shrink-0">{t("models.default")}</Badge>}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{model.modelId}</div>
                </div>
                <div className="hidden flex-wrap justify-end gap-1 md:flex md:max-w-40">
                  {model.capabilities.map((capability) => (
                    <Badge key={capability} variant="outline">{capability}</Badge>
                  ))}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-brand"
                    disabled={model.isDefault || isSettingDefault}
                    title={t("models.setDefault")}
                    aria-label={t("models.setDefault")}
                    onClick={() => onSetDefault(model.id)}
                  >
                    <ShieldCheck className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-brand"
                    title={t("models.editModel")}
                    aria-label={t("models.editModel")}
                    onClick={() => onEditModel(model.id)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    disabled={isDeleting}
                    title={t("models.deleteModel")}
                    aria-label={t("models.deleteModel")}
                    onClick={() => onDeleteModel(model.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <form className="space-y-4" onSubmit={onSubmitModel}>
            <DialogHeader>
              <DialogTitle>{selectedModelId ? t("models.editModel") : t("models.addModel")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="model-form-name">{t("common.name")}</Label>
              <Input
                id="model-form-name"
                value={modelForm.name}
                onChange={(event) => onModelFormChange({ ...modelForm, name: event.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-form-model-id">{t("models.modelId")}</Label>
              <Input
                id="model-form-model-id"
                value={modelForm.modelId}
                onChange={(event) => onModelFormChange({ ...modelForm, modelId: event.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t("models.capabilities")}</Label>
              <div className="flex flex-wrap gap-3">
                {COMMON_MODEL_CAPABILITIES.map((capability) => (
                  <label key={capability} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand"
                      checked={modelForm.capabilities.includes(capability)}
                      onChange={() => toggleCapability(capability)}
                    />
                    {capability}
                  </label>
                ))}
              </div>
              <Input
                id="model-form-custom-capabilities"
                value={modelForm.customCapabilities}
                onChange={(event) =>
                  onModelFormChange({ ...modelForm, customCapabilities: event.target.value })
                }
                placeholder={t("models.customCapabilitiesPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-form-context-window">{t("models.contextWindow")}</Label>
              <Input
                id="model-form-context-window"
                type="number"
                min={1}
                step={1}
                placeholder={t("models.contextWindowPlaceholder")}
                value={modelForm.contextWindow}
                onChange={(event) => onModelFormChange({ ...modelForm, contextWindow: event.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t("models.contextWindowHint")}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => onDialogOpenChange(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {selectedModelId ? t("models.saveModel") : t("models.addModel")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
