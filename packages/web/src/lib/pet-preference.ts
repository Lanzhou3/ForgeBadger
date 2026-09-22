import type { TranslationKey } from "./i18n";

export const PET_OPTIONS = [
  { id: "robot", nameKey: "settings.petRobot", descriptionKey: "settings.petRobotDescription" },
] as const satisfies readonly { id: string; nameKey: TranslationKey; descriptionKey: TranslationKey }[];

export type PetId = (typeof PET_OPTIONS)[number]["id"];
export const DEFAULT_PET_ID: PetId = "robot";
export const PET_STORAGE_KEY = "forgebadger.pet";
const PET_CHANGED_EVENT = "forgebadger:pet-changed";

function isPetId(value: unknown): value is PetId {
  return PET_OPTIONS.some((pet) => pet.id === value);
}

export function readPetPreference(): PetId {
  try {
    const stored = window.localStorage.getItem(PET_STORAGE_KEY);
    return isPetId(stored) ? stored : DEFAULT_PET_ID;
  } catch {
    return DEFAULT_PET_ID;
  }
}

export function writePetPreference(id: PetId): boolean {
  if (!isPetId(id)) return false;
  try {
    window.localStorage.setItem(PET_STORAGE_KEY, id);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(PET_CHANGED_EVENT));
  return true;
}

/** One shared preference for the settings card and the floating companion. */
export function subscribePetPreference(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === PET_STORAGE_KEY || event.key === null) onChange();
  }
  window.addEventListener(PET_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PET_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
