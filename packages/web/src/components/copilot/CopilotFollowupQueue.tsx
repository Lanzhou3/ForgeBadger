"use client";

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelFollowup, listFollowups, queueFollowup, type CopilotFollowup } from '@/lib/copilot-api';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/use-language';
import { toast } from '@/lib/toast';

interface Props { conversationId: string; projectId?: string; modelId?: string; active?: boolean; }

export function CopilotFollowupQueue({ conversationId, projectId, modelId, active = true }: Props) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const queryKey = ['copilot-followups', conversationId];
  const query = useQuery({ queryKey, queryFn: () => listFollowups(conversationId), refetchInterval: state => active || state.state.data?.followups.some(item => item.status === 'queued') ? 5000 : false });
  const items = (query.data?.followups ?? []).filter(item => item.status === 'queued' || item.status === 'failed');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<{ content: string; id: string } | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    ++epoch.current;
    setBusy(false); setText(''); request.current = null;
    return () => { epoch.current++; };
  }, [conversationId]);

  // Surface sync failures as a toast instead of an inline red line; the query
  // keeps retrying on its refetch interval.
  const syncErrorToastRef = useRef(false);
  useEffect(() => {
    if (query.isError && !syncErrorToastRef.current) {
      syncErrorToastRef.current = true;
      toast.error(t('copilot.followups.syncFailed'));
    }
    if (!query.isError) syncErrorToastRef.current = false;
  }, [query.isError, t]);

  async function submit() {
    const content = text.trim(); if (!content || busy) return;
    const generation = epoch.current;
    if (request.current?.content !== content) request.current = { content, id: crypto.randomUUID() };
    setBusy(true);
    try {
      await queueFollowup(conversationId, content, { clientRequestId: request.current.id,
        ...(projectId ? { projectId } : {}), ...(modelId ? { modelId } : {}) });
      await query.refetch({ throwOnError: true });
      if (epoch.current !== generation) return;
      setText(''); request.current = null;
    } catch {
      if (epoch.current === generation) toast.error(t('copilot.followups.enqueueUncertain'));
    }
    finally { if (epoch.current === generation) setBusy(false); }
  }

  async function cancel(id: string) {
    const generation = epoch.current;
    try {
      const result = await cancelFollowup(id);
      if (epoch.current !== generation) return;
      if (result.cancelled) client.setQueryData<{ followups: CopilotFollowup[] }>(queryKey, current => current ? { followups: current.followups.filter(item => item.id !== id) } : current);
      else toast.error(t('copilot.followups.cancelStarted'));
    } catch { if (epoch.current === generation) toast.error(t('copilot.followups.cancelFailed')); }
  }

  if (!active && !items.length && !query.isError) return null;
  return <div className="space-y-2 rounded-md border border-border/70 p-3">
    <p className="text-xs text-muted-foreground">{t('copilot.followups.hint')}</p>
    {items.map(item => <div key={item.id} className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate">{item.status === 'failed' ? t('copilot.followups.failedPrefix') : t('copilot.followups.queuedPrefix')}{item.content}</span>
      {item.status === 'queued' && <Button size="sm" variant="ghost" onClick={() => void cancel(item.id)}>{t('copilot.followups.cancelQueued')}</Button>}
    </div>)}
    <div className="flex gap-2">
      <input aria-label={t('copilot.followups.inputLabel')} value={text} onChange={event => setText(event.target.value)} maxLength={32768}
        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm" disabled={busy} />
      <Button size="sm" variant="outline" disabled={busy || !text.trim()} onClick={() => void submit()}>{t('copilot.followups.enqueue')}</Button>
    </div>
  </div>;
}
