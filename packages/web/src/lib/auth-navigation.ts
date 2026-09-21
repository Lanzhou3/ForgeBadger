const invitationKey = "forgebadger.team-invitation";
const maxAgeMs = 30 * 60 * 1000;
export function safeRedirectTarget(next: string | null): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    /[\\\x00-\x20]/.test(next) ||
    /%5c|%0[ad]/i.test(next)
  )
    return "/";
  try {
    const parsed = new URL(next, "https://forgebadger.invalid");
    return parsed.origin === "https://forgebadger.invalid"
      ? parsed.pathname + parsed.search + parsed.hash
      : "/";
  } catch {
    return "/";
  }
}
export function captureTeamInvitation(): string {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  if (token !== null && (!token || token.length > 512)) {
    clearTeamInvitation();
    return "";
  }
  if (token && token.length <= 512) {
    try {
      sessionStorage.setItem(
        invitationKey,
        JSON.stringify({ token, expires: Date.now() + maxAgeMs }),
      );
    } catch {
      /* Current page still holds the token. */
    }
    return token;
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(invitationKey) ?? "null");
    if (
      stored &&
      typeof stored.token === "string" &&
      stored.expires > Date.now()
    )
      return stored.token;
  } catch {
    /* Invalid tab state is discarded. */
  }
  clearTeamInvitation();
  return "";
}
export function clearTeamInvitation() {
  try {
    sessionStorage.removeItem(invitationKey);
  } catch {
    /* Storage may be unavailable. */
  }
}
