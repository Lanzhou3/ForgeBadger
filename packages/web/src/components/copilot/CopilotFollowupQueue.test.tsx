// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopilotFollowupQueue } from './CopilotFollowupQueue';
const api = vi.hoisted(() => ({ listFollowups: vi.fn(), queueFollowup: vi.fn(), cancelFollowup: vi.fn() }));
vi.mock('@/lib/copilot-api', () => api);
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>; }
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('retries with the same key after an ambiguous response and cancels a queued item', async () => {
  api.listFollowups.mockResolvedValue({ followups: [] });
  api.queueFollowup.mockRejectedValueOnce(new Error('lost response')).mockImplementation(async () => {
    api.listFollowups.mockResolvedValue({ followups: [{ id: 'q1', content: 'Next task', status: 'queued' }] });
  });
  api.cancelFollowup.mockResolvedValue({ cancelled: true });
  render(<CopilotFollowupQueue conversationId="c1" projectId="p1" modelId="m1" />, { wrapper });
  fireEvent.change(screen.getByLabelText('后续消息'), { target: { value: 'Next task' } });
  fireEvent.click(screen.getByText('加入队列'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('加入队列'));
  await screen.findByText('等待：Next task');
  expect(api.queueFollowup.mock.calls[0]).toEqual(api.queueFollowup.mock.calls[1]);
  expect(api.queueFollowup.mock.calls[0]![2]).toMatchObject({ projectId: 'p1', modelId: 'm1' });
  fireEvent.click(screen.getByText('取消排队'));
  await waitFor(() => expect(screen.queryByText('等待：Next task')).toBeNull());
});

it('ignores a late conversation response after switching and resets submission state', async () => {
  let resolve!: (value: { followups: unknown[] }) => void;
  api.listFollowups.mockImplementation((id: string) => id === 'c1' ? new Promise(r => { resolve = r; }) : Promise.resolve({ followups: [] }));
  const view = render(<CopilotFollowupQueue conversationId="c1" />, { wrapper });
  view.rerender(<CopilotFollowupQueue conversationId="c2" />);
  await act(async () => resolve({ followups: [{ id: 'old', status: 'queued', content: 'old message' }] }));
  expect(screen.queryByText('等待：old message')).toBeNull();
  fireEvent.change(screen.getByLabelText('后续消息'), { target: { value: 'new' } });
  expect(screen.getByText('加入队列').hasAttribute('disabled')).toBe(false);
});
