"use client";
import { useEffect, useState } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { fetchJson, listModelProviders } from '@/lib/api';
import { listConversationRuns } from '@/lib/copilot-api';
import { useSettingsCopy } from './settings-copy';
interface Rates { inputUsdPerMillion:number;outputUsdPerMillion:number;cachedInputUsdPerMillion?:number;cacheWriteUsdPerMillion?:number }
interface Usage { reportedTokens:number;chargedTokens:number;estimatedCalls:number;calls:number;costUsd:number|null;knownCostUsd:number;unpricedCalls:number }
interface Props { conversationId:string|null;modelId:string|null }
export function CopilotMeteringPanel({conversationId,modelId}:Props) {
 const copy=useSettingsCopy();
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
 const save=useMutation({mutationFn:()=>fetchJson(`/api/v1/copilot/token-rates/${encodeURIComponent(id!)}`,{method:'PUT',body:JSON.stringify(Object.fromEntries(fieldNames.flatMap((name)=>{const value=values[name]??String(rates.data?.rates?.[name as keyof Rates]??'');return value===''?[]:[[name,Number(value)]];})))}),onSuccess:()=>{setValues({});void cache.invalidateQueries({queryKey:key});}});
 const revoke=useMutation({mutationFn:()=>fetchJson(`/api/v1/copilot/runs/${runId}/repairs`,{method:'DELETE'})});
 const data=usage.data?.usage;
 const resetRevoke=revoke.reset;
 useEffect(()=>{resetRevoke();},[runId,resetRevoke]);
 return <details className="border-b border-border/70 px-4 py-1 text-xs" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary className="cursor-pointer text-muted-foreground">{copy.meterTitle}</summary>
  <div className="space-y-2 py-2">
   {(models.isError||rates.isError||runs.isError||usage.isError)&&<p role="alert">{copy.meterLoadError}</p>}
   {usage.isLoading&&<p>{copy.meterLoadingUsage}</p>}
   {data?(data.costUsd===null
     ?<p>{copy.meterUsageEstimated(data.reportedTokens,data.estimatedCalls,data.knownCostUsd.toFixed(6),data.unpricedCalls)}</p>
     :<p>{copy.meterUsageCost(data.reportedTokens,data.estimatedCalls,data.costUsd.toFixed(6))}</p>)
    :!usage.isLoading&&<p>{copy.meterNoUsage}</p>}
   <p className="text-muted-foreground">{copy.meterRatesHint}</p>
   <form key={id} onSubmit={e=>{e.preventDefault();save.mutate();}} className="flex flex-wrap items-end gap-2">
    {fieldNames.map((name)=><label key={name} className="grid gap-1">{fieldLabels[name](copy)}<input aria-label={fieldLabels[name](copy)} type="number" min="0" max="1000000" step="0.000001" required={name==='inputUsdPerMillion'||name==='outputUsdPerMillion'} disabled={!id||rates.isLoading} value={values[name]??rates.data?.rates?.[name as keyof Rates]??''} onChange={e=>setValues({...values,[name]:e.target.value})} className="w-24 rounded border border-border bg-background px-2 py-1"/></label>)}
    <button disabled={!id||save.isPending||rates.isError} className="rounded border border-border px-2 py-1">{copy.meterSave}</button>
   </form>
   {save.isError&&<p role="alert">{copy.meterSaveError}</p>}{save.isSuccess&&<p>{copy.meterSaved}</p>}
   {runId&&<button disabled={revoke.isPending||revoke.isSuccess} onClick={()=>revoke.mutate()} className="rounded border border-border px-2 py-1">{revoke.isSuccess?copy.meterRevoked:copy.meterRevoke}</button>}
   {revoke.isError&&<p role="alert">{copy.meterRevokeError}</p>}
  </div>
 </details>;
}
const fieldNames=['inputUsdPerMillion','outputUsdPerMillion','cachedInputUsdPerMillion','cacheWriteUsdPerMillion'] as const;
type MeteringCopy = ReturnType<typeof useSettingsCopy>;
const fieldLabels: Record<(typeof fieldNames)[number], (copy: MeteringCopy) => string> = {
  inputUsdPerMillion: (copy) => copy.meterInputRate,
  outputUsdPerMillion: (copy) => copy.meterOutputRate,
  cachedInputUsdPerMillion: (copy) => copy.meterCachedRate,
  cacheWriteUsdPerMillion: (copy) => copy.meterCacheWriteRate,
};
