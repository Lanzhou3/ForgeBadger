"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_PET_ID, readPetPreference, subscribePetPreference } from "@/lib/pet-preference";

const serverSnapshot = () => DEFAULT_PET_ID;

export function usePetPreference() {
  return useSyncExternalStore(subscribePetPreference, readPetPreference, serverSnapshot);
}
