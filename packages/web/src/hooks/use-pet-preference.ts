"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PET_ID,
  readPetPreference,
  readPetVisiblePreference,
  subscribePetPreference,
  subscribePetVisiblePreference,
} from "@/lib/pet-preference";

const serverSnapshot = () => DEFAULT_PET_ID;
const visibleServerSnapshot = () => true;

export function usePetPreference() {
  return useSyncExternalStore(subscribePetPreference, readPetPreference, serverSnapshot);
}

export function usePetVisiblePreference() {
  return useSyncExternalStore(
    subscribePetVisiblePreference,
    readPetVisiblePreference,
    visibleServerSnapshot,
  );
}
