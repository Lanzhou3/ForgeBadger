export const ACTIVATION_DISMISSED_STORAGE_KEY = "forgebadger.activation-dismissed";

export function readActivationDismissed(): boolean {
  try {
    return window.localStorage.getItem(ACTIVATION_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeActivationDismissed(): boolean {
  try {
    window.localStorage.setItem(ACTIVATION_DISMISSED_STORAGE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
