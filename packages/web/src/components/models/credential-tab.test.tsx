// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  generation: 1,
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
  const content = (props: typeof overrides) => (
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
        {...props}
      />
    </QueryClientProvider>
  );
  const view = render(content(overrides));
  return { ...view, client, rerenderTab: (props: typeof overrides) => view.rerender(content(props)) };
}

function revealForm(): HTMLFormElement {
  return screen.getByLabelText("models.revealPassword").closest("form") as HTMLFormElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("credential-tab secret reveal", () => {
  it('clears a displayed secret when rotation advances the generation with the same masked preview', async () => {
    vi.mocked(revealProviderCredential).mockResolvedValue({ secret: 'old-generation-secret' });
    const { rerenderTab } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'models.revealApiKey' }));
    fireEvent.change(await screen.findByLabelText('models.revealPassword'), { target: { value: 'password-fixture' } });
    fireEvent.submit(revealForm());
    await screen.findByText('old-generation-secret');
    rerenderTab({ credentials: [{ ...activeCredential, generation: 2 }] });
    expect(screen.queryByText('old-generation-secret')).toBeNull();
    expect(screen.queryByRole('button', { name: 'models.copyApiKey' })).toBeNull();
  });

  it('discards a pending reveal if its credential generation changes', async () => {
    let resolve!: (value: { secret: string }) => void;
    vi.mocked(revealProviderCredential).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { rerenderTab } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'models.revealApiKey' }));
    fireEvent.change(await screen.findByLabelText('models.revealPassword'), { target: { value: 'password-fixture' } });
    fireEvent.submit(revealForm());
    await waitFor(() => expect(resolve).toBeTruthy());
    rerenderTab({ credentials: [{ ...activeCredential, generation: 2 }] });
    await act(async () => resolve({ secret: 'old-generation-secret' }));
    expect(screen.queryByText('old-generation-secret')).toBeNull();
    expect(screen.queryByLabelText('models.revealPassword')).toBeNull();
  });
  it('keeps plaintext out of shared query and mutation caches after reveal, hide and unmount', async () => {
    vi.mocked(revealProviderCredential).mockResolvedValue({ secret: 'cache-fixture-secret' });
    const { client, unmount } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'models.revealApiKey' }));
    fireEvent.change(await screen.findByLabelText('models.revealPassword'), { target: { value: 'password-fixture' } });
    fireEvent.submit(revealForm());
    await screen.findByText('cache-fixture-secret');
    const assertNoSecret = () => {
      const cached = JSON.stringify([client.getQueryCache().getAll(), client.getMutationCache().getAll().map(m => m.state)]);
      expect(cached).not.toContain('cache-fixture-secret');
      expect(cached).not.toContain('password-fixture');
    };
    assertNoSecret();
    fireEvent.click(screen.getByRole('button', { name: 'models.hideApiKey' }));
    assertNoSecret();
    unmount();
    assertNoSecret();
    client.clear();
  });

  for (const outcome of ['success', 'error'] as const) {
    it(`discards late ${outcome} from A after closing and opening B`, async () => {
      let resolve!: (value: { secret: string }) => void;
      let reject!: (error: Error) => void;
      vi.mocked(revealProviderCredential).mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
      renderTab({ credentials: [activeCredential, { ...activeCredential, id: 'cred-B', label: 'key B' }] });
      fireEvent.click(screen.getAllByRole('button', { name: 'models.revealApiKey' })[0]!);
      fireEvent.change(await screen.findByLabelText('models.revealPassword'), { target: { value: 'password-fixture' } });
      fireEvent.submit(revealForm());
      await waitFor(() => expect(resolve).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      fireEvent.click(screen.getAllByRole('button', { name: 'models.revealApiKey' })[1]!);
      await act(async () => outcome === 'success' ? resolve({ secret: 'secret-for-A' }) : reject(new Error('error-for-A')));
      expect(screen.queryByText('secret-for-A')).toBeNull();
      expect(screen.queryByText('error-for-A')).toBeNull();
      expect(screen.getByLabelText('models.revealPassword')).toBeTruthy();
    });
  }

  it('does not populate caches when a pending reveal resolves after unmount', async () => {
    let resolve!: (value: { secret: string }) => void;
    vi.mocked(revealProviderCredential).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { client, unmount } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'models.revealApiKey' }));
    fireEvent.change(await screen.findByLabelText('models.revealPassword'), { target: { value: 'password-fixture' } });
    fireEvent.submit(revealForm());
    await waitFor(() => expect(resolve).toBeTruthy());
    unmount();
    await act(async () => resolve({ secret: 'late-secret' }));
    expect(JSON.stringify(client.getMutationCache().getAll().map(m => m.state))).not.toContain('late-secret');
    client.clear();
  });
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
