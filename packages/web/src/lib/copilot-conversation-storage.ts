/**
 * Shared "last active Copilot conversation" contract between the floating
 * robot panel and the full /copilot console: whichever surface the user last
 * worked in writes its conversation id here, so opening the other surface
 * resumes the same conversation instead of a stale one.
 *
 * Kept in a dependency-free module so the console can import it without
 * pulling the robot panel's markdown-rendering stack (react-markdown/shiki)
 * into the console bundle — the panel is lazy-loaded precisely for that.
 */
export const LAST_COPILOT_CONVERSATION_KEY = "forgebadger.copilot.robot-conversation";
export const COPILOT_MODEL_KEY = "forgebadger.copilot.model";

export function readCopilotModelPreference(): string | null {
  try {
    return window.localStorage.getItem(COPILOT_MODEL_KEY);
  } catch {
    return null;
  }
}

export function writeCopilotModelPreference(modelId: string | null): void {
  try {
    if (modelId) window.localStorage.setItem(COPILOT_MODEL_KEY, modelId);
    else window.localStorage.removeItem(COPILOT_MODEL_KEY);
  } catch {
    // Storage unavailable: the picker simply falls back to the system default.
  }
}

export function readLastCopilotConversation(): string | null {
  try {
    return window.localStorage.getItem(LAST_COPILOT_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

export function writeLastCopilotConversation(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(LAST_COPILOT_CONVERSATION_KEY, id);
    else window.localStorage.removeItem(LAST_COPILOT_CONVERSATION_KEY);
  } catch {
    // Storage unavailable (private mode, quota): both surfaces fall back to
    // a fresh draft, so the conversation simply isn't resumed.
  }
}
