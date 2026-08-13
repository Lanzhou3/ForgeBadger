import type { AdapterDiscovery, TerminalRuntimeStatus } from "@/lib/api";
import { isAdapterLaunchable } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";

export type ActivationStepId = "runtime" | "adapter" | "model" | "project" | "session";

type LaunchableAdapterLike = Pick<AdapterDiscovery, "available" | "launchEnabled">;

export interface ActivationAction {
  href: string;
  labelKey: TranslationKey;
}

export interface ActivationStep {
  id: ActivationStepId;
  labelKey: TranslationKey;
  detailKey: TranslationKey;
  done: boolean;
  action: ActivationAction;
}

export interface ActivationReadinessInput {
  terminalRuntime?: TerminalRuntimeStatus;
  dependenciesLoading?: boolean;
  dependenciesError?: boolean;
  adapters?: readonly LaunchableAdapterLike[];
  adaptersLoading?: boolean;
  adaptersError?: boolean;
  modelsHealthy?: boolean;
  modelsLoading?: boolean;
  modelsError?: boolean;
  projectCount: number;
  sessionCount: number;
  firstProjectId?: string;
}

export interface ActivationReadiness {
  steps: ActivationStep[];
  complete: boolean;
  currentStepId: ActivationStepId | null;
  primaryAction: ActivationAction;
  secondaryActions: ActivationAction[];
}

export function buildActivationReadiness(input: ActivationReadinessInput): ActivationReadiness {
  const runtimeGuidance = getTerminalRuntimeSetupGuidance(
    input.terminalRuntime?.mode,
    input.terminalRuntime?.supported
  );
  const runtimeReady = runtimeGuidance.blocked === false;
  const adapterReady = !input.adaptersLoading
    && !input.adaptersError
    && (input.adapters ?? []).some(isAdapterLaunchable);
  // Session model selection is optional in host-environment mode. The model
  // catalog must be reachable, but an empty user-created model list is not a
  // launch blocker for Claude, OpenCode, or Codex CLI defaults.
  const modelReady = !input.modelsLoading && !input.modelsError;
  const projectReady = input.projectCount > 0;
  const sessionReady = input.sessionCount > 0;
  const firstProjectHref = input.firstProjectId ? `/projects/${input.firstProjectId}` : "/projects";

  const steps: ActivationStep[] = [
    {
      id: "runtime",
      labelKey: "dashboard.activationRuntime",
      detailKey: runtimeDetailKey(input, runtimeGuidance.descriptionKey),
      done: runtimeReady,
      action: { href: "/settings", labelKey: "dashboard.activationOpenSettings" },
    },
    {
      id: "adapter",
      labelKey: "dashboard.activationAdapter",
      detailKey: adapterDetailKey(input, adapterReady),
      done: adapterReady,
      action: { href: "/settings", labelKey: "dashboard.activationOpenSettings" },
    },
    {
      id: "model",
      labelKey: "dashboard.activationModel",
      detailKey: modelDetailKey(input, modelReady),
      done: modelReady,
      action: { href: "/models", labelKey: "dashboard.activationOpenModels" },
    },
    {
      id: "project",
      labelKey: "dashboard.activationProject",
      detailKey: projectReady ? "dashboard.firstRunProjectReady" : "dashboard.firstRunProjectMissing",
      done: projectReady,
      action: { href: "/projects/new", labelKey: "projects.create" },
    },
    {
      id: "session",
      labelKey: "dashboard.activationSession",
      detailKey: sessionReady ? "dashboard.firstRunSessionReady" : "dashboard.firstRunSessionMissing",
      done: sessionReady,
      action: { href: firstProjectHref, labelKey: "dashboard.activationStartSession" },
    },
  ];

  const currentStep = steps.find((step) => !step.done);
  const complete = !currentStep;
  return {
    steps,
    complete,
    currentStepId: currentStep?.id ?? null,
    primaryAction: complete
      ? { href: "/sessions", labelKey: "dashboard.activationContinueSession" }
      : currentStep.action,
    secondaryActions: currentStep?.id === "project"
      ? [{ href: "/projects/import", labelKey: "projects.import" }]
      : [],
  };
}

function runtimeDetailKey(
  input: Pick<ActivationReadinessInput, "dependenciesLoading" | "dependenciesError" | "terminalRuntime">,
  fallbackKey: TranslationKey
): TranslationKey {
  if (input.dependenciesLoading) return "dashboard.activationRuntimeLoading";
  if (input.dependenciesError || !input.terminalRuntime) return "dashboard.activationRuntimeUnavailable";
  return fallbackKey;
}

function adapterDetailKey(
  input: Pick<ActivationReadinessInput, "adaptersLoading" | "adaptersError">,
  ready: boolean
): TranslationKey {
  if (input.adaptersLoading) return "dashboard.activationAdapterLoading";
  if (input.adaptersError) return "dashboard.activationAdapterUnavailable";
  return ready ? "dashboard.activationAdapterReady" : "dashboard.activationAdapterMissing";
}

function modelDetailKey(
  input: Pick<ActivationReadinessInput, "modelsLoading" | "modelsError">,
  ready: boolean
): TranslationKey {
  if (input.modelsLoading) return "dashboard.activationModelLoading";
  if (input.modelsError) return "dashboard.activationModelUnavailable";
  return ready ? "dashboard.activationModelReady" : "dashboard.activationModelMissing";
}
