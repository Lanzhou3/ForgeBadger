import { type FormEvent } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

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
import type { ProviderCredentialSummary } from "@/lib/api";

import { EmptyLine, type CredentialForm, type Translate } from "./shared";

interface CredentialTabProps {
  credentials: ProviderCredentialSummary[];
  selectedCredentialId: string;
  credentialForm: CredentialForm;
  rotateDialogOpen: boolean;
  isSaving: boolean;
  isRotating: boolean;
  isDeleting: boolean;
  onCredentialFormChange: (form: CredentialForm) => void;
  onRotateDialogOpenChange: (open: boolean) => void;
  onSelectCredential: (credentialId: string) => void;
  onSubmitCredential: (event: FormEvent<HTMLFormElement>) => void;
  onOpenRotate: (credentialId: string) => void;
  onConfirmRotate: () => void;
  onDeleteCredential: (credentialId: string) => void;
  t: Translate;
}

export function CredentialTab({
  credentials,
  selectedCredentialId,
  credentialForm,
  rotateDialogOpen,
  isSaving,
  isRotating,
  isDeleting,
  onCredentialFormChange,
  onRotateDialogOpenChange,
  onSelectCredential,
  onSubmitCredential,
  onOpenRotate,
  onConfirmRotate,
  onDeleteCredential,
  t,
}: CredentialTabProps) {
  return (
    <div className="space-y-4">
      <form className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={onSubmitCredential}>
        <div className="space-y-2">
          <Label htmlFor="credential-label">{t("models.credentialLabel")}</Label>
          <Input
            id="credential-label"
            placeholder={t("models.defaultCredentialLabel")}
            value={credentialForm.label}
            onChange={(event) => onCredentialFormChange({ ...credentialForm, label: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="credential-secret">{t("models.apiKey")}</Label>
          <Input
            id="credential-secret"
            type="password"
            placeholder={t("models.apiKeyPlaceholder")}
            value={credentialForm.plaintextSecret}
            onChange={(event) => onCredentialFormChange({ ...credentialForm, plaintextSecret: event.target.value })}
            required
          />
        </div>
        <Button type="submit" disabled={isSaving}>
          <Plus className="size-4" />
          {t("models.saveCredential")}
        </Button>
      </form>

      {credentials.length === 0 ? (
        <EmptyLine text={t("models.emptyCredentials")} />
      ) : (
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card">
          {credentials.map((credential, index) => (
            <div
              key={credential.id}
              className={`flex items-center gap-3 px-4 py-3 transition-colors forgebadger-animate-in hover:bg-muted/40 ${
                credential.id === selectedCredentialId ? "bg-brand/5" : ""
              }`}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectCredential(credential.id)}
              >
                <div className="truncate text-sm font-medium">
                  {credential.label ?? t("models.unnamedCredential")}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {credential.secretPreview}
                </div>
              </button>
              <Badge variant="outline" className="shrink-0">{credential.status}</Badge>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-brand"
                  title={t("models.rotate")}
                  aria-label={t("models.rotate")}
                  onClick={() => onOpenRotate(credential.id)}
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={isDeleting}
                  title={t("models.deleteCredential")}
                  aria-label={t("models.deleteCredential")}
                  onClick={() => onDeleteCredential(credential.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={rotateDialogOpen} onOpenChange={onRotateDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onConfirmRotate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("models.rotateApiKey")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="rotate-credential-label">{t("models.credentialLabel")}</Label>
              <Input
                id="rotate-credential-label"
                placeholder={t("models.defaultCredentialLabel")}
                value={credentialForm.label}
                onChange={(event) => onCredentialFormChange({ ...credentialForm, label: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rotate-credential-secret">{t("models.apiKey")}</Label>
              <Input
                id="rotate-credential-secret"
                type="password"
                placeholder={t("models.apiKeyPlaceholder")}
                value={credentialForm.plaintextSecret}
                onChange={(event) => onCredentialFormChange({ ...credentialForm, plaintextSecret: event.target.value })}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isRotating}
                onClick={() => onRotateDialogOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isRotating || !credentialForm.plaintextSecret}>
                <RefreshCw className={`size-4 ${isRotating ? "animate-spin" : ""}`} />
                {t("models.rotate")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
