# Session Notification Bell + In-App Toast Acceptance

> Date: 2026-08-11
> Scope: pure frontend delivery — session-page notification bell and real-time
> in-app toast for code CLI permission requests and session-ending events
> Gate status: GATE 1 / 2 / 3 passed

## Delivery Overview

Pure web console delivery (no Gateway change). Two observable surfaces:

- **Session page notification bell** — `components/sessions/session-notification-bell.tsx`,
  rendered at the top-right of `/sessions/[id]` in both the normal top bar and the
  `preparing` / `error` fallback header (`SessionFallbackHeader`). It shows an unread
  Badge (capped at `99+` for counts above 99) and links to `/notifications`.
- **Real-time in-app toast** — sonner toasts at `top-right`, `theme="dark"`, mounted as
  `<Toaster position="top-right" theme="dark" />` in `app/providers.tsx`. Notification
  events arriving over `/ws/events` show a toast: `permission_prompt` stays ~12 s, session
  `stopped` / `completed` / `error` stays ~5 s. Clicking the toast action "Open session"
  soft-navigates to the target session and marks the notification read. The trigger
  predicate is the existing `shouldTriggerBrowserNotification` from
  `lib/browser-notifications.ts` — reused verbatim for parity with native browser
  notifications.

Changed files:

- Added `web/src/lib/notification-toast.ts` (+ `notification-toast.test.ts`, 5 cases)
- Added `web/src/components/sessions/session-notification-bell.tsx`
- Modified `web/src/app/providers.tsx` (mounted `<Toaster>`)
- Modified `web/src/hooks/use-notifications.tsx` (toast wiring, stable `markRead`
  via `useCallback`, `useRouter` for soft navigation)
- Modified `web/src/app/(dashboard)/sessions/[id]/page.tsx` (bell in normal top bar and
  in the `SessionFallbackHeader` branch)

## Automated Verification

| Check | Result |
| --- | --- |
| Web full suite | Pass: 219 cases |
| New `notification-toast.test.ts` | Pass: 5 cases (duration selection ×3, toast rendering with action ×2) |
| Web typecheck | Pass (clean) |

Vitest runs without jsdom in this workspace, so React component rendering (bell badge,
toast rendering, soft navigation) is covered by the manual browser checklist below rather
than by component tests.

Context note (not a defect of this delivery): two suites already failing in the working
tree before this delivery (`ConfigSyncPanel.test.tsx`, `templates/page.test.tsx`) remain
failing due to a pre-existing `vi.mock` hoisting defect in uncommitted workspace changes;
they are unrelated to this delivery and are not reported as delivery issues.

## Manual Browser Checklist

Requires a real code CLI session plus a running Gateway and Web dev server. Check each
item in the browser.

- [ ] 1. From the session page, operate the code CLI to trigger a permission request
      (`claude_notification` + `notification_type=permission_prompt`) → a dark toast
      appears at the top-right and stays ~12 s.
- [ ] 2. Change the session state to `stopped` / `completed` / `error` → a toast appears
      and stays ~5 s.
- [ ] 3. Click the toast "Open session" action → soft-navigates to the target
      `/sessions/:id` (no full page reload) and that notification becomes read (unread
      count drops on the bell and in the sidebar).
- [ ] 4. The bell is visible in both the session page's normal top bar and the
      `preparing` / `error` fallback header; the unread Badge count is correct (counts
      above 99 render as `99+`); clicking the bell navigates to `/notifications`.
- [ ] 5. Native browser notifications still work per their existing switch (unaffected);
      turning off browser notifications does not suppress the in-app toast (by design).
- [ ] 6. A notification already marked read does not trigger a toast; a plain
      `claude_notification` that is not `permission_prompt` does not trigger a toast
      (matches `shouldTriggerBrowserNotification` semantics).
- [ ] 7. A transition to `running` does not trigger a toast (the predicate only matches
      `stopped` / `completed` / `error`).
- [ ] 8. Comparison item: the toast theme is always dark (root `html` has
      `className="dark"`); in a light-mode UI the toast remains dark (per spec).

## Known Notes

- The toast trigger surface is identical to the native browser notification surface:
  `permission_prompt` plus session-ending states (`stopped` / `completed` / `error`).
  `permission_denied` does not trigger a toast.
