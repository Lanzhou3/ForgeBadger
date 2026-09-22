type SessionConnectStatus = "idle" | "pending" | "success" | "error";

interface AutoConnectSessionInput {
  sessionId: string;
  hasAuthToken: boolean;
  hasAttachTokenOverride: boolean;
  isConnecting: boolean;
  hasConnectedSession: boolean;
  hasConnectError: boolean;
}

interface SessionPreparingInput {
  hasAuthToken: boolean;
  hasAttachTokenOverride: boolean;
  connectStatus: SessionConnectStatus;
  hasConnectError: boolean;
  /** True when a session is already available (from a settled connect or a
   *  resolved GET). When we already have content to show there is no reason to
   *  block on the terminal behind a "preparing" fallback. */
  hasSession: boolean;
}

interface LoadSessionActivitiesInput {
  sessionId: string;
  hasSession: boolean;
}

export function shouldAutoConnectSession(input: AutoConnectSessionInput): boolean {
  return (
    input.sessionId.length > 0 &&
    input.hasAuthToken &&
    !input.hasAttachTokenOverride &&
    !input.isConnecting &&
    !input.hasConnectedSession &&
    !input.hasConnectError
  );
}

export function shouldShowSessionPreparing(input: SessionPreparingInput): boolean {
  return (
    input.hasAuthToken &&
    !input.hasAttachTokenOverride &&
    !input.hasConnectError &&
    !input.hasSession &&
    (input.connectStatus === "idle" || input.connectStatus === "pending")
  );
}

export function shouldLoadSessionActivities(input: LoadSessionActivitiesInput): boolean {
  return input.sessionId.length > 0 && input.hasSession;
}
