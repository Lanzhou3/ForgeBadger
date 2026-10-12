// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import type { Translate } from "./shared";

const t: Translate = (key: string) => {
  const labels: Record<string, string> = {
    "models.deleteProviderTitle": "删除服务商？",
    "models.deleteProviderWarning": "将删除服务商",
    "models.deleteModelTitle": "删除模型？",
    "models.deleteModelWarning": "将删除模型",
    "models.deleteCredentialTitle": "删除凭据？",
    "models.deleteCredentialConfirm": "将删除凭据",
    "models.deleting": "删除中...",
    "common.cancel": "取消",
    "common.delete": "删除",
  };
  return labels[key] ?? key;
};

describe("DeleteConfirmDialog", () => {
  it("names the provider being deleted", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog
        target={{ kind: "provider", providerId: "p1", name: "Acme Relay" }}
        isDeleting={false}
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        t={t}
      />
    );
    expect(screen.getByText("删除服务商？")).toBeTruthy();
    expect(screen.getByText(/Acme Relay/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("names the model and credential targets too", () => {
    const { rerender } = render(
      <DeleteConfirmDialog
        target={{ kind: "model", modelId: "m1", name: "claude-sonnet" }}
        isDeleting={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        t={t}
      />
    );
    expect(screen.getByText(/claude-sonnet/)).toBeTruthy();

    rerender(
      <DeleteConfirmDialog
        target={{ kind: "credential", credentialId: "c1", name: "prod key" }}
        isDeleting={false}
        onOpenChange={() => {}}
        onConfirm={() => {}}
        t={t}
      />
    );
    expect(screen.getByText(/prod key/)).toBeTruthy();
  });
});
