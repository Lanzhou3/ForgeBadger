import type { AdapterDiscovery, TerminalRuntimeStatus } from "@/lib/api";
import { isAdapterLaunchable } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { getTerminalRuntimeSetupGuidance } from "@/lib/terminal-runtime";

export type ActivationStepId =
  | "runtime"
  | "adapter"
  | "model"
  | "project"
  | "session"
  | "delivery";

type LaunchableAdapterLike = Pick<
  AdapterDiscovery,
  "available" | "launchEnabled"
>;

export interface ActivationAction {
  href: string;
  labelKey: TranslationKey;
}

export interface ActivationStep {
  id: ActivationStepId;
  labelKey: TranslationKey;
  detailKey: TranslationKey;
  done: boolean;
  optional?: boolean;
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
  acceptedDeliveries?: number;
  firstProjectId?: string;
}

export interface ActivationReadiness {
  steps: ActivationStep[];
  complete: boolean;
  currentStepId: ActivationStepId | null;
  primaryAction: ActivationAction;
  secondaryActions: ActivationAction[];
}

export function buildActivationReadiness(
  input: ActivationReadinessInput,
): ActivationReadiness {
  const runtimeGuidance = getTerminalRuntimeSetupGuidance(
    input.terminalRuntime?.mode,
    input.terminalRuntime?.supported,
  );
  const runtimeReady = runtimeGuidance.blocked === false;
  const adapterReady =
    !input.adaptersLoading &&
    !input.adaptersError &&
    (input.adapters ?? []).some(isAdapterLaunchable);
  // Host CLI settings are optional guidance, never a platform catalog gate.
  const projectReady = input.projectCount > 0;
  const sessionReady = input.sessionCount > 0;
  const firstProjectHref = input.firstProjectId
    ? `/projects/${input.firstProjectId}?tab=project-manager`
    : "/projects";

  const steps: ActivationStep[] = [
    {
      id: "runtime",
      labelKey: "dashboard.activationRuntime",
      detailKey: runtimeDetailKey(input, runtimeGuidance.descriptionKey),
      done: runtimeReady,
      action: {
        href: "/settings",
        labelKey: "dashboard.activationOpenSettings",
      },
    },
    {
      id: "adapter",
      labelKey: "dashboard.activationAdapter",
      detailKey: adapterDetailKey(input, adapterReady),
      done: adapterReady,
      action: {
        href: "/settings",
        labelKey: "dashboard.activationOpenSettings",
      },
    },
    {
      id: "model",
      labelKey: "dashboard.activationModel",
      detailKey: "dashboard.activationModelReady",
      done: false,
      optional: true,
      action: { href: "/models", labelKey: "dashboard.activationOpenModels" },
    },
    {
      id: "project",
      labelKey: "dashboard.activationProject",
      detailKey: projectReady
        ? "dashboard.firstRunProjectReady"
        : "dashboard.firstRunProjectMissing",
      done: projectReady,
      action: { href: "/projects/new", labelKey: "projects.create" },
    },
    {
      id: "session",
      labelKey: "dashboard.activationSession",
      detailKey: sessionReady
        ? "dashboard.firstRunSessionReady"
        : "dashboard.firstRunSessionMissing",
      done: sessionReady,
      optional: true,
      action: {
        href: firstProjectHref,
        labelKey: "dashboard.activationStartDelivery",
      },
    },
    {
      id: "delivery",
      labelKey: "dashboard.activationDelivery",
      detailKey:
        (input.acceptedDeliveries ?? 0) > 0
          ? "dashboard.activationDeliveryReady"
          : "dashboard.activationDeliveryMissing",
      done: (input.acceptedDeliveries ?? 0) > 0,
      action: {
        href: "/projects",
        labelKey: "dashboard.activationStartDelivery",
      },
    },
  ];

  const currentStep = steps.find((step) => !step.optional && !step.done);
  const complete = !currentStep;
  return {
    steps,
    complete,
    currentStepId: currentStep?.id ?? null,
    primaryAction: complete
      ? {
          href: "/projects",
          labelKey: "dashboard.activationContinueDelivery",
        }
      : currentStep.action,
    secondaryActions:
      currentStep?.id === "project"
        ? [{ href: "/projects/import", labelKey: "projects.import" }]
        : [],
  };
}

function runtimeDetailKey(
  input: Pick<
    ActivationReadinessInput,
    "dependenciesLoading" | "dependenciesError" | "terminalRuntime"
  >,
  fallbackKey: TranslationKey,
): TranslationKey {
  if (input.dependenciesLoading) return "dashboard.activationRuntimeLoading";
  if (input.dependenciesError || !input.terminalRuntime)
    return "dashboard.activationRuntimeUnavailable";
  return fallbackKey;
}

function adapterDetailKey(
  input: Pick<ActivationReadinessInput, "adaptersLoading" | "adaptersError">,
  ready: boolean,
): TranslationKey {
  if (input.adaptersLoading) return "dashboard.activationAdapterLoading";
  if (input.adaptersError) return "dashboard.activationAdapterUnavailable";
  return ready
    ? "dashboard.activationAdapterReady"
    : "dashboard.activationAdapterMissing";
}
