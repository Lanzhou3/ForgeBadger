export type CredentialMode = "stored_encrypted_key" | "host_environment";

export interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  secretEnvNames: string[];
  credentialMode: CredentialMode;
}

export interface ClaudeLaunchPlanInput {
  projectRoot: string;
  credentialMode: CredentialMode;
  env?: Record<string, string>;
  secretEnvNames?: string[];
  pluginDirs?: string[] | undefined;
}

export function createClaudeLaunchPlan(input: ClaudeLaunchPlanInput): LaunchPlan {
  return {
    command: "claude",
    args: pluginDirArgs(input.pluginDirs ?? []),
    cwd: input.projectRoot,
    env: input.env ?? {},
    // A worker ACK capability is a process-local secret even when Claude uses
    // host credentials, so secret classification cannot depend on credential mode.
    secretEnvNames: input.secretEnvNames ?? [],
    credentialMode: input.credentialMode
  };
}

function pluginDirArgs(pluginDirs: string[]): string[] {
  return pluginDirs.flatMap((directory) => ["--plugin-dir", directory]);
}
