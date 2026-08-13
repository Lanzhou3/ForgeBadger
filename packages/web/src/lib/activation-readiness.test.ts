import { describe, expect, it } from "vitest";

import { buildActivationReadiness } from "./activation-readiness";

const readyRuntime = {
  persistence: "tmux" as const,
  mode: "native_tmux",
  supported: true,
  message: "tmux 3.6b",
};

const readyAdapter = {
  id: "claude",
  label: "Claude Code",
  command: "claude",
  available: true,
  launchEnabled: true,
  runtimeModes: ["terminal"],
};

describe("buildActivationReadiness", () => {
  it("prioritizes terminal runtime blockers before adapter and project setup", () => {
    const readiness = buildActivationReadiness({
      terminalRuntime: {
        ...readyRuntime,
        mode: "tmux_missing",
        supported: false,
        message: "tmux not found",
      },
      adapters: [readyAdapter],
      modelsHealthy: true,
      projectCount: 0,
      sessionCount: 0,
    });

    expect(readiness.complete).toBe(false);
    expect(readiness.currentStepId).toBe("runtime");
    expect(readiness.primaryAction).toEqual({
      href: "/settings",
      labelKey: "dashboard.activationOpenSettings",
    });
    expect(readiness.steps.map((step) => [step.id, step.done])).toEqual([
      ["runtime", false],
      ["adapter", true],
      ["model", true],
      ["project", false],
      ["session", false],
    ]);
  });

  it("surfaces missing launchable CLI adapters before model and project setup", () => {
    const readiness = buildActivationReadiness({
      terminalRuntime: readyRuntime,
      adapters: [{ ...readyAdapter, available: false }],
      modelsHealthy: true,
      projectCount: 1,
      sessionCount: 0,
      firstProjectId: "project-1",
    });

    expect(readiness.complete).toBe(false);
    expect(readiness.currentStepId).toBe("adapter");
    expect(readiness.primaryAction).toEqual({
      href: "/settings",
      labelKey: "dashboard.activationOpenSettings",
    });
    expect(readiness.steps.find((step) => step.id === "adapter")).toMatchObject({
      done: false,
      detailKey: "dashboard.activationAdapterMissing",
    });
  });

  it("does not block host-environment sessions when no custom model exists", () => {
    const readiness = buildActivationReadiness({
      terminalRuntime: readyRuntime,
      adapters: [readyAdapter],
      modelsHealthy: false,
      projectCount: 1,
      sessionCount: 0,
      firstProjectId: "project-1",
    });

    expect(readiness.currentStepId).toBe("session");
    expect(readiness.primaryAction).toEqual({
      href: "/projects/project-1",
      labelKey: "dashboard.activationStartSession",
    });
    expect(readiness.steps.find((step) => step.id === "model")).toMatchObject({ done: true });
  });

  it("routes prepared users without a project to create or import a project", () => {
    const readiness = buildActivationReadiness({
      terminalRuntime: readyRuntime,
      adapters: [readyAdapter],
      modelsHealthy: true,
      projectCount: 0,
      sessionCount: 0,
    });

    expect(readiness.currentStepId).toBe("project");
    expect(readiness.primaryAction).toEqual({
      href: "/projects/new",
      labelKey: "projects.create",
    });
    expect(readiness.secondaryActions).toEqual([
      { href: "/projects/import", labelKey: "projects.import" },
    ]);
  });

  it("routes prepared users with a project but no session to the first project launch path", () => {
    const readiness = buildActivationReadiness({
      terminalRuntime: readyRuntime,
      adapters: [readyAdapter],
      modelsHealthy: true,
      projectCount: 1,
      sessionCount: 0,
      firstProjectId: "project-1",
    });

    expect(readiness.currentStepId).toBe("session");
    expect(readiness.primaryAction).toEqual({
      href: "/projects/project-1",
      labelKey: "dashboard.activationStartSession",
    });
    expect(readiness.steps.map((step) => step.id)).toEqual([
      "runtime",
      "adapter",
      "model",
      "project",
      "session",
    ]);
  });

  it("marks activation complete and links to sessions once a local AI CLI session exists", () => {
    const readiness = buildActivationReadiness({
      terminalRuntime: readyRuntime,
      adapters: [readyAdapter],
      modelsHealthy: true,
      projectCount: 1,
      sessionCount: 1,
      firstProjectId: "project-1",
    });

    expect(readiness.complete).toBe(true);
    expect(readiness.currentStepId).toBeNull();
    expect(readiness.primaryAction).toEqual({
      href: "/sessions",
      labelKey: "dashboard.activationContinueSession",
    });
  });
});
