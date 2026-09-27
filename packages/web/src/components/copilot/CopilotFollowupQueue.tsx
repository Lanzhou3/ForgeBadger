"use client";

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelFollowup, listFollowups, queueFollowup, type CopilotFollowup } from '@/lib/copilot-api';
import { Button } from '@/components/ui/button';

interface Props { conversationId: string; projectId?: string; modelId?: string; active?: boolean; }

export function CopilotFollowupQueue({ conversationId, projectId, modelId, active = true }: Props) {
  const client = useQueryClient();
  const queryKey = ['copilot-followups', conversationId];
  const query = useQuery({ queryKey, queryFn: () => listFollowups(conversationId), refetchInterval: state => active || state.state.data?.followups.some(item => item.status === 'queued') ? 5000 : false });
  const items = (query.data?.followups ?? []).filter(item => item.status === 'queued' || item.status === 'failed');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ content: string; id: string } | null>(null);
  const epoch = useRef(0);
  useEffect(() => {
    ++epoch.current;
    setBusy(false); setText(''); setError(''); request.current = null;
    return () => { epoch.current++; };
  }, [conversationId]);

  async function submit() {
    const content = text.trim(); if (!content || busy) return;
    const generation = epoch.current;
    if (request.current?.content !== content) request.current = { content, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      await queueFollowup(conversationId, content, { clientRequestId: request.current.id,
        ...(projectId ? { projectId } : {}), ...(modelId ? { modelId } : {}) });
      await query.refetch({ throwOnError: true });
      if (epoch.current !== generation) return;
      setText(''); request.current = null;
    } catch { if (epoch.current === generation) setError('未能确认排队结果，可以重试同一条消息。'); }
    finally { if (epoch.current === generation) setBusy(false); }
  }

  async function cancel(id: string) {
    const generation = epoch.current;
    try {
      const result = await cancelFollowup(id);
      if (epoch.current !== generation) return;
      if (result.cancelled) client.setQueryData<{ followups: CopilotFollowup[] }>(queryKey, current => current ? { followups: current.followups.filter(item => item.id !== id) } : current);
      else setError('这条消息已开始执行，请在当前执行中取消。');
    } catch { if (epoch.current === generation) setError('取消失败，请重试。'); }
  }

  if (!active && !items.length && !query.isError) return null;
  return <div className="space-y-2 rounded-md border border-border/70 p-3">
    <p className="text-xs text-muted-foreground">后续消息会在当前执行结束后处理。</p>
    {items.map(item => <div key={item.id} className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate">{item.status === 'failed' ? '未执行：' : '等待：'}{item.content}</span>
      {item.status === 'queued' && <Button size="sm" variant="ghost" onClick={() => void cancel(item.id)}>取消排队</Button>}
    </div>)}
    <div className="flex gap-2">
      <input aria-label="后续消息" value={text} onChange={event => setText(event.target.value)} maxLength={32768}
        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm" disabled={busy} />
      <Button size="sm" variant="outline" disabled={busy || !text.trim()} onClick={() => void submit()}>加入队列</Button>
    </div>
    {(error || query.isError) && <p role="alert" className="text-xs text-destructive">{error || '后续消息同步失败，请稍后重试。'}</p>}
  </div>;
}
