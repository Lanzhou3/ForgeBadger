"use client";

import { useId, useState } from "react";
import { Bot, Check } from "lucide-react";

import { RobotSprite } from "@/components/copilot/RobotSprite";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";
import { usePetPreference } from "@/hooks/use-pet-preference";
import { PET_OPTIONS, writePetPreference, type PetId } from "@/lib/pet-preference";
import { cn } from "@/lib/utils";

export function PetSettings() {
  const { t } = useLanguage();
  const petId = usePetPreference();
  const titleId = useId();
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");

  function selectPet(id: PetId) {
    setSaveState(writePetPreference(id) ? "saved" : "error");
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <Bot className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <CardTitle id={titleId} className="text-sm font-semibold">{t("settings.pet")}</CardTitle>
          <CardDescription className="mt-1 text-xs">{t("settings.petDescription")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div role="radiogroup" aria-labelledby={titleId} className="grid gap-3 sm:grid-cols-2">
          {PET_OPTIONS.map((pet) => {
            const selected = petId === pet.id;
            const nameId = `${titleId}-${pet.id}-name`;
            const descriptionId = `${titleId}-${pet.id}-description`;
            return (
              <button
                key={pet.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-labelledby={nameId}
                aria-describedby={descriptionId}
                onClick={() => selectPet(pet.id)}
                className={cn(
                  "flex items-center gap-3 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-brand/60 bg-brand/10" : "border-border hover:bg-muted/40"
                )}
              >
                <span className="shrink-0 rounded-md bg-muted/40 p-1" aria-hidden="true">
                  <RobotSprite frame="stand" size={80} />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span id={nameId} className="block text-sm font-medium">{t(pet.nameKey)}</span>
                  <span id={descriptionId} className="block text-xs leading-relaxed text-muted-foreground">
                    {t(pet.descriptionKey)}
                  </span>
                  {selected && (
                    <span className="flex items-center gap-1 text-xs text-brand" aria-hidden="true">
                      <Check className="size-3" />{t("settings.petSelected")}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {saveState === "saved" && <p role="status" className="text-xs text-muted-foreground">{t("settings.petSaved")}</p>}
        {saveState === "error" && <p role="alert" className="text-xs text-destructive">{t("settings.petSaveFailed")}</p>}
      </CardContent>
    </Card>
  );
}
