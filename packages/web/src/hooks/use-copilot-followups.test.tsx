// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { LanguageProvider } from '@/hooks/use-language';
import { useCopilotFollowups } from './use-copilot-followups';

const api = vi.hoisted(() => ({ listFollowups: vi.fn(), queueFollowup: vi.fn(), cancelFollowup: vi.fn() }));
const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }));
vi.mock('@/lib/copilot-api', () => api);
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: toastErrorMock } }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {children}
      </QueryClientProvider>
    </LanguageProvider>
  );
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('retries with the same request key after an ambiguous response and cancels a queued item', async () => {
  api.listFollowups.mockResolvedValue({ followups: [] });
  api.queueFollowup.mockRejectedValueOnce(new Error('lost response')).mockImplementation(async () => {
    api.listFollowups.mockResolvedValue({ followups: [{ id: 'q1', content: 'Next task', status: 'queued' }] });
  });
  api.cancelFollowup.mockResolvedValue({ cancelled: true });
  const { result } = renderHook(() => useCopilotFollowups({ conversationId: 'c1', projectId: 'p1', modelId: 'm1', active: false }), { wrapper });

  expect(await result.current.enqueue('Next task')).toBe(false);
  await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('未能确认排队结果，可以重试同一条消息。'));

  // The retained key makes the manual retry idempotent instead of a second turn.
  expect(await result.current.enqueue('Next task')).toBe(true);
  expect(api.queueFollowup.mock.calls[0]).toEqual(api.queueFollowup.mock.calls[1]);
  expect(api.queueFollowup.mock.calls[0]![2]).toMatchObject({ projectId: 'p1', modelId: 'm1' });
  await waitFor(() => expect(result.current.items).toHaveLength(1));

  await act(async () => { await result.current.cancel('q1'); });
  await waitFor(() => expect(result.current.items).toHaveLength(0));
});

it('exposes only queued and failed items', async () => {
  api.listFollowups.mockResolvedValue({
    followups: [
      { id: 'q1', content: 'waiting', status: 'queued' },
      { id: 'f1', content: 'broken', status: 'failed' },
      { id: 'd1', content: 'done', status: 'completed' },
    ],
  });
  const { result } = renderHook(() => useCopilotFollowups({ conversationId: 'c1', active: false }), { wrapper });
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(result.current.items.map(item => item.id)).toEqual(['q1', 'f1']);
});

it('ignores a late conversation response after switching conversations', async () => {
  let resolve!: (value: { followups: unknown[] }) => void;
  api.listFollowups.mockImplementation((id: string) => id === 'c1' ? new Promise(r => { resolve = r; }) : Promise.resolve({ followups: [] }));
  const { result, rerender } = renderHook(({ id }: { id: string }) => useCopilotFollowups({ conversationId: id, active: false }), {
    wrapper,
    initialProps: { id: 'c1' },
  });
  rerender({ id: 'c2' });
  await act(async () => resolve({ followups: [{ id: 'old', status: 'queued', content: 'old message' }] }));
  await waitFor(() => expect(result.current.items).toHaveLength(0));
  expect(result.current.enqueuing).toBe(false);
});

it('does not enqueue without a conversation', async () => {
  const { result } = renderHook(() => useCopilotFollowups({ conversationId: null, active: false }), { wrapper });
  expect(await result.current.enqueue('anything')).toBe(false);
  expect(api.queueFollowup).not.toHaveBeenCalled();
});

it('keeps a complete execution options snapshot and request identity after an uncertain enqueue', async () => {
  api.listFollowups.mockResolvedValue({ followups: [] });
  api.queueFollowup.mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({});
  const { result, rerender } = renderHook(({ modelId, reviewTaskResults, repairFailedChecks }) => useCopilotFollowups({
    conversationId: 'c1', projectId: 'p1', modelId, reviewTaskResults, repairFailedChecks, active: true,
  }), { wrapper, initialProps: { modelId: 'm1', reviewTaskResults: true, repairFailedChecks: true } });
  await act(async () => { expect(await result.current.enqueue('continue')).toBe(false); });
  rerender({ modelId: 'm2', reviewTaskResults: false, repairFailedChecks: false });
  await act(async () => { expect(await result.current.enqueue('continue')).toBe(true); });
  expect(api.queueFollowup.mock.calls[0]![2]).toMatchObject({ projectId: 'p1', modelId: 'm1', reviewTaskResults: true, repairFailedChecks: true });
  expect(api.queueFollowup.mock.calls[1]).toEqual(api.queueFollowup.mock.calls[0]);
});
