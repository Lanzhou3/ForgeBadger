import { describe, expect, it } from "vitest";
import { buildActivationReadiness } from "./activation-readiness";

const readyRuntime = {
  persistence: "session-server" as const,
  mode: "ready" as const,
  supported: true,
  message: "Session server ready",
};
const readyAdapter = {
  id: "claude",
  label: "Claude Code",
  command: "claude",
  available: true,
  launchEnabled: true,
  runtimeModes: ["terminal"],
};
const prepared = {
  terminalRuntime: readyRuntime,
  adapters: [readyAdapter],
  projectCount: 1,
  sessionCount: 0,
  firstProjectId: "project-1",
};

describe("buildActivationReadiness", () => {
  it("prioritizes terminal runtime blockers before development", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      terminalRuntime: {
        ...readyRuntime,
        mode: "unavailable",
        supported: false,
      },
      projectCount: 0,
    });
    expect(readiness.complete).toBe(false);
    expect(readiness.currentStepId).toBe("runtime");
    expect(readiness.primaryAction).toEqual({
      href: "/settings",
      labelKey: "dashboard.activationOpenSettings",
    });
  });
  it("surfaces missing launchable CLI adapters before project setup", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      adapters: [{ ...readyAdapter, available: false }],
    });
    expect(readiness.currentStepId).toBe("adapter");
    expect(readiness.steps.find((step) => step.id === "adapter")).toMatchObject(
      { done: false, detailKey: "dashboard.activationAdapterMissing" },
    );
  });
  it("does not block native host CLI use when Model Center fails or is loading", () => {
    for (const models of [
      { modelsError: true },
      { modelsLoading: true },
      { modelsHealthy: false },
    ]) {
      const readiness = buildActivationReadiness({ ...prepared, ...models });
      expect(readiness.currentStepId).toBe("delivery");
      expect(readiness.steps.find((step) => step.id === "model")).toMatchObject(
        {
          done: false,
          optional: true,
          detailKey: "dashboard.activationModelReady",
        },
      );
      expect(readiness.primaryAction).toEqual({
        href: "/projects",
        labelKey: "dashboard.activationStartDelivery",
      });
    }
  });
  it("routes users without a project to create or import one", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      projectCount: 0,
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
  it("starts the task delivery flow without requiring a separate private session first", () => {
    const readiness = buildActivationReadiness(prepared);
    expect(readiness.currentStepId).toBe("delivery");
    expect(readiness.steps.find((step) => step.id === "session")).toMatchObject(
      {
        optional: true,
        done: false,
        action: { href: "/projects/project-1?tab=project-manager" },
      },
    );
    expect(readiness.steps.map((step) => step.id)).toEqual([
      "runtime",
      "adapter",
      "model",
      "project",
      "session",
      "delivery",
    ]);
  });
  it("never equates an existing session with a completed first development", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      sessionCount: 10,
      acceptedDeliveries: 0,
    });
    expect(readiness.complete).toBe(false);
    expect(readiness.currentStepId).toBe("delivery");
    expect(
      readiness.steps.find((step) => step.id === "delivery"),
    ).toMatchObject({
      done: false,
      detailKey: "dashboard.activationDeliveryMissing",
    });
  });
  it("requires explicit server evidence rather than an absent summary field", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      sessionCount: 1,
    });
    expect(readiness.complete).toBe(false);
  });
  it("marks first delivery complete only after server-reported safe integration", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      sessionCount: 1,
      acceptedDeliveries: 1,
      modelsError: true,
    });
    expect(readiness.complete).toBe(true);
    expect(readiness.currentStepId).toBeNull();
    expect(
      readiness.steps.find((step) => step.id === "delivery"),
    ).toMatchObject({
      done: true,
      detailKey: "dashboard.activationDeliveryReady",
    });
    expect(readiness.primaryAction).toEqual({
      href: "/projects",
      labelKey: "dashboard.activationContinueDelivery",
    });
  });
});
