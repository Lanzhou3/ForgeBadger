// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialTab } from "./credential-tab";
import { revealProviderCredential, type ProviderCredentialSummary } from "@/lib/api";
import { toast } from "@/lib/toast";

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/api", () => ({
  revealProviderCredential: vi.fn(),
}));

const activeCredential: ProviderCredentialSummary = {
  id: "cred-1",
  providerProfileId: "prov-1",
  label: "default key",
  status: "active",
  secretPreview: "********",
};

const revokedCredential: ProviderCredentialSummary = {
  ...activeCredential,
  id: "cred-2",
  label: "old key",
  status: "revoked",
};

const noops = {
  onCredentialFormChange: vi.fn(),
  onRotateDialogOpenChange: vi.fn(),
  onSelectCredential: vi.fn(),
  onSubmitCredential: vi.fn(),
  onOpenRotate: vi.fn(),
  onConfirmRotate: vi.fn(),
  onDeleteCredential: vi.fn(),
};

function renderTab(overrides: Partial<Parameters<typeof CredentialTab>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CredentialTab
        credentials={[activeCredential]}
        selectedCredentialId="cred-1"
        credentialForm={{ label: "", plaintextSecret: "" }}
        rotateDialogOpen={false}
        isSaving={false}
        isRotating={false}
        isDeleting={false}
        t={(key) => key}
        {...noops}
        {...overrides}
      />
    </QueryClientProvider>
  );
}

function revealForm(): HTMLFormElement {
  return screen.getByLabelText("models.revealPassword").closest("form") as HTMLFormElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("credential-tab secret reveal", () => {
  it("hides the secret by default and offers the reveal eye only for active credentials", () => {
    renderTab({ credentials: [activeCredential, revokedCredential] });
    expect(screen.getAllByText("********")).toHaveLength(2);
    // One eye for the active credential; none for the revoked one.
    expect(screen.getByRole("button", { name: "models.revealApiKey" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "models.copyApiKey" })).toBeNull();
  });

  it("reveals the stored secret after the account password is accepted", async () => {
    vi.mocked(revealProviderCredential).mockResolvedValue({ secret: "sk-real-key-123" });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "models.revealApiKey" }));
    const input = await screen.findByLabelText("models.revealPassword");
    fireEvent.change(input, { target: { value: "my-account-pass" } });
    fireEvent.submit(revealForm());

    await waitFor(() =>
      expect(revealProviderCredential).toHaveBeenCalledWith("prov-1", "cred-1", "my-account-pass")
    );
    await screen.findByText("sk-real-key-123");
    // The masked preview is replaced by the real secret plus copy/hide actions.
    expect(screen.queryByText("********")).toBeNull();
    expect(screen.getByRole("button", { name: "models.copyApiKey" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "models.hideApiKey" })).toBeTruthy();
  });

  it("keeps the dialog open and shows the gateway error when the password is rejected", async () => {
    vi.mocked(revealProviderCredential).mockRejectedValue(new Error("Invalid password"));
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "models.revealApiKey" }));
    const input = await screen.findByLabelText("models.revealPassword");
    fireEvent.change(input, { target: { value: "wrong-pass" } });
    fireEvent.submit(revealForm());

    expect(await screen.findByText("Invalid password")).toBeTruthy();
    // The dialog stays open and the secret stays masked.
    expect(screen.getByLabelText("models.revealPassword")).toBeTruthy();
    expect(screen.getByText("********")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "models.copyApiKey" })).toBeNull();
  });

  it("hides the revealed secret again on demand", async () => {
    vi.mocked(revealProviderCredential).mockResolvedValue({ secret: "sk-real-key-123" });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "models.revealApiKey" }));
    const input = await screen.findByLabelText("models.revealPassword");
    fireEvent.change(input, { target: { value: "my-account-pass" } });
    fireEvent.submit(revealForm());
    await screen.findByText("sk-real-key-123");

    fireEvent.click(screen.getByRole("button", { name: "models.hideApiKey" }));
    expect(screen.queryByText("sk-real-key-123")).toBeNull();
    expect(screen.getByText("********")).toBeTruthy();
    expect(screen.getByRole("button", { name: "models.revealApiKey" })).toBeTruthy();
  });

  it("copies the revealed secret to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    vi.mocked(revealProviderCredential).mockResolvedValue({ secret: "sk-real-key-123" });
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "models.revealApiKey" }));
    const input = await screen.findByLabelText("models.revealPassword");
    fireEvent.change(input, { target: { value: "my-account-pass" } });
    fireEvent.submit(revealForm());
    await screen.findByText("sk-real-key-123");

    fireEvent.click(screen.getByRole("button", { name: "models.copyApiKey" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sk-real-key-123"));
    expect(toast.success).toHaveBeenCalledWith("models.apiKeyCopied");
  });
});
