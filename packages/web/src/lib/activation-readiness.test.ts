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
  it("does not include a host CLI model settings step", () => {
    const readiness = buildActivationReadiness(prepared);
    expect(readiness.steps.map((step) => step.id as string)).not.toContain(
      "model",
    );
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
  it("completes readiness without requiring a session or delivery first", () => {
    const readiness = buildActivationReadiness(prepared);
    expect(readiness.complete).toBe(true);
    expect(readiness.currentStepId).toBeNull();
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
      "project",
      "session",
      "delivery",
    ]);
    expect(readiness.primaryAction).toEqual({
      href: "/projects",
      labelKey: "dashboard.activationContinueDelivery",
    });
  });
  it("keeps the first-delivery guidance optional and undone without a delivery", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      sessionCount: 10,
      acceptedDeliveries: 0,
    });
    expect(readiness.complete).toBe(true);
    expect(
      readiness.steps.find((step) => step.id === "delivery"),
    ).toMatchObject({
      done: false,
      optional: true,
      detailKey: "dashboard.activationDeliveryMissing",
    });
  });
  it("requires explicit server evidence rather than an absent summary field", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      sessionCount: 1,
    });
    expect(
      readiness.steps.find((step) => step.id === "delivery"),
    ).toMatchObject({ done: false });
  });
  it("marks the delivery step done after server-reported safe integration", () => {
    const readiness = buildActivationReadiness({
      ...prepared,
      sessionCount: 1,
      acceptedDeliveries: 1,
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
