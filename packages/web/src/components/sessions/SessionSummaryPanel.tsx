"use client";
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '@/hooks/use-language';
import { localeForLanguage } from '@/lib/i18n';
import { getSessionSummary } from '@/lib/session-summary-api';

interface Props {sessionId:string}
export function SessionSummaryPanel({sessionId}:Props) {
  const {language}=useLanguage();
  const en=language==='en';
  const locale=localeForLanguage(language);
  const query=useQuery({queryKey:['session-summary',sessionId],queryFn:()=>getSessionSummary(sessionId),
    refetchInterval:5000,refetchIntervalInBackground:false,retry:false});
  const current=query.data?.summary;
  const result=query.data?.latestResult;
  const state=query.data?.workState;
  return <details className="shrink-0 border-b border-border bg-muted/20 px-3 py-2 text-sm" data-testid="session-summary">
    <summary className="cursor-pointer text-muted-foreground">{en?'Latest session progress':'会话最新进度'}
      {state?` · ${state==='working'?(en?'Working':'执行中'):state==='idle'?(en?'Idle':'空闲'):(en?'Current progress unknown':'当前进度未知')}`:''}</summary>
    <div className="max-h-64 space-y-2 overflow-auto py-2">
      {query.isPending&&<p role="status">{en?'Loading…':'正在读取…'}</p>}
      {query.isError&&<p role="alert">{en?'Could not load the session summary.':'无法读取会话摘要。'}</p>}
      {query.data&&!current&&!result&&<p>{en?'No observations captured. Restart the CLI to load updated hooks.':'尚未采集到观察记录，CLI 需重新启动以加载更新后的 hooks。'}</p>}
      {current?.request&&<p className="break-words">{en?'Current request: ':'当前请求：'}{current.request}</p>}
      {current?.progress.map((p,i)=><p key={`${i}:${p.text}`} className="break-words">{p.text}</p>)}
      {result&&<>
        <p className="text-xs text-muted-foreground">{en?'Latest recorded round':'最近记录的轮次'} · {new Date(result.observedAt).toLocaleString(locale)}</p>
        <p className="whitespace-pre-wrap break-words">{result.error?.text??result.result?.text??(en?'Round result not captured.':'未采集到本轮结果。')}</p>
        {result.result&&<p className="text-xs text-muted-foreground">{en?'Source: CLI final reply':'来源：CLI 最终回复'}</p>}
        {result.error&&<p className="text-xs text-muted-foreground">{en?'Source: CLI error event':'来源：CLI 错误事件'}</p>}
        {result.identityQuality!=='exact_turn'&&<p className="text-xs text-muted-foreground">{en?'Round identity unconfirmed; event excerpt only.':'轮次未确认，仅展示本次事件摘录。'}</p>}
        {result.verification.length?result.verification.map((v,i)=><p key={`${i}:${v.text}`} className="break-words">{v.text}</p>)
          :<p className="text-xs text-muted-foreground">{en?'No command verification evidence captured.':'未采集到命令验证证据。'}</p>}
      </>}
      {current&&<p className="text-xs text-muted-foreground">{en?'Last observation: ':'最后观察：'}{new Date(current.observedAt).toLocaleString(locale)}</p>}
    </div>
  </details>;
}
