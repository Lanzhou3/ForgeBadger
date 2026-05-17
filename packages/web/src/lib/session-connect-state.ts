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
    (input.connectStatus === "idle" || input.connectStatus === "pending")
  );
}

export function shouldLoadSessionActivities(input: LoadSessionActivitiesInput): boolean {
  return input.sessionId.length > 0 && input.hasSession;
}
