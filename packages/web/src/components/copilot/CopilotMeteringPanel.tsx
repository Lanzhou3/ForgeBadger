"use client";
import { useEffect, useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { fetchJson, listModelProviders } from '@/lib/api';
import { listConversationRuns } from '@/lib/copilot-api';
interface Rates { inputUsdPerMillion:number;outputUsdPerMillion:number;cachedInputUsdPerMillion?:number;cacheWriteUsdPerMillion?:number }
interface Usage { reportedTokens:number;chargedTokens:number;estimatedCalls:number;calls:number;costUsd:number|null;knownCostUsd:number;unpricedCalls:number }
interface Props { conversationId:string|null;modelId:string|null }
export function CopilotMeteringPanel({conversationId,modelId}:Props) {
 const [open,setOpen]=useState(false),[values,setValues]=useState<Record<string,string>>({});
 const cache=useQueryClient();
 const models=useQuery({queryKey:['model-providers'],queryFn:listModelProviders,enabled:open});
 const id=modelId??models.data?.models.find(m=>m.isDefault)?.id??models.data?.models[0]?.id;
 useEffect(()=>{setValues({});},[id]);
 const key=['copilot','token-rates',id];
 const rates=useQuery({queryKey:key,queryFn:()=>fetchJson<{rates:Rates|null}>(`/api/v1/copilot/token-rates/${encodeURIComponent(id!)}`),enabled:open&&!!id});
 const runs=useQuery({queryKey:['copilot','meter-runs',conversationId],queryFn:()=>listConversationRuns(conversationId!),enabled:open&&!!conversationId,refetchInterval:open?5000:false});
 const runId=runs.data?.runs[0]?.id;
 const usage=useQuery({queryKey:['copilot','meter',runId],queryFn:()=>fetchJson<{usage:Usage}>(`/api/v1/copilot/runs/${runId}/usage`),enabled:open&&!!runId,refetchInterval:open?5000:false});
 const save=useMutation({mutationFn:()=>fetchJson(`/api/v1/copilot/token-rates/${encodeURIComponent(id!)}`,{method:'PUT',body:JSON.stringify(Object.fromEntries(fields.flatMap(([name])=>{const value=values[name]??String(rates.data?.rates?.[name as keyof Rates]??'');return value===''?[]:[[name,Number(value)]];})))}),onSuccess:()=>{setValues({});void cache.invalidateQueries({queryKey:key});}});
 const revoke=useMutation({mutationFn:()=>fetchJson(`/api/v1/copilot/runs/${runId}/repairs`,{method:'DELETE'})});
 const data=usage.data?.usage;
 const resetRevoke=revoke.reset;
 useEffect(()=>{resetRevoke();},[runId,resetRevoke]);
 return <details className="border-b border-border/70 px-4 py-1 text-xs" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary className="cursor-pointer text-muted-foreground">用量、计价与修复控制</summary>
  <div className="space-y-2 py-2">
   {(models.isError||rates.isError||runs.isError||usage.isError)&&<p role="alert">用量或费率读取失败，请重试。</p>}
   {usage.isLoading&&<p>读取用量…</p>}
   {data?<p>供应商报告 {data.reportedTokens} tokens；{data.estimatedCalls} 次调用仍为估算。费用：{data.costUsd===null?`未知（已知部分 $${data.knownCostUsd.toFixed(6)}，${data.unpricedCalls} 次未计价）`:`$${data.costUsd.toFixed(6)}`}。</p>:!usage.isLoading&&<p>当前尚无执行用量。</p>}
   <p className="text-muted-foreground">以下为所选模型每百万 tokens 的美元费率，最多六位小数。空白表示未知，0 表示免费；历史调用保留原费率。这是按配置计算的费用，不是供应商账单。</p>
   <form key={id} onSubmit={e=>{e.preventDefault();save.mutate();}} className="flex flex-wrap items-end gap-2">
    {fields.map(([name,label])=><label key={name} className="grid gap-1">{label}<input aria-label={label} type="number" min="0" max="1000000" step="0.000001" required={name==='inputUsdPerMillion'||name==='outputUsdPerMillion'} disabled={!id||rates.isLoading} value={values[name]??rates.data?.rates?.[name as keyof Rates]??''} onChange={e=>setValues({...values,[name]:e.target.value})} className="w-24 rounded border border-border bg-background px-2 py-1"/></label>)}
    <button disabled={!id||save.isPending||rates.isError} className="rounded border border-border px-2 py-1">保存费率</button>
   </form>
   {save.isError&&<p role="alert">费率保存失败，请检查输入。</p>}{save.isSuccess&&<p>费率已保存。</p>}
   {runId&&<button disabled={revoke.isPending||revoke.isSuccess} onClick={()=>revoke.mutate()} className="rounded border border-border px-2 py-1">{revoke.isSuccess?'已停止后续修复':'停止本次执行的后续修复'}</button>}
   {revoke.isError&&<p role="alert">停止修复失败，请重试。</p>}
  </div>
 </details>;
}
const fields=[['inputUsdPerMillion','输入费率'],['outputUsdPerMillion','输出费率'],['cachedInputUsdPerMillion','缓存读取费率'],['cacheWriteUsdPerMillion','缓存写入费率']] as const;
