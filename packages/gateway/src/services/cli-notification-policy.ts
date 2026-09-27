/** Hook lifecycle stages are not interchangeable with user-facing notifications. */
export function shouldNotifyCliHook(adapter: string, event: Record<string, unknown>): boolean {
  const hook = event.hook_event_name ?? 'Notification';
  if (hook === 'PermissionRequest') {
    // Claude hooks can decide requests; Codex runs these before auto-review.
    // Their actual UI prompts arrive via Notification / terminal OSC respectively.
    return adapter !== 'claude' && adapter !== 'codex';
  }
  if (hook === 'Notification') return event.notification_type === 'permission_prompt';
  // Never promote background-task notifications, subagent stops, permission
  // outcomes, interrupts or process exits to main-task completion.
  if (hook !== 'Stop' && hook !== 'StopFailure') return false;
  if (event.agent_id !== undefined && event.agent_id !== null && event.agent_id !== '') return false;
  return true;
}
