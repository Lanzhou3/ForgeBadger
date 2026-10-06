"use client";
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { SettingsCardHeader } from "@/components/settings/ui";
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { GatewayApiError } from '@/lib/api';
import { getFeishuNotificationSettings, saveFeishuNotificationSettings, getFeishuNotificationDeliveries, testFeishuNotification, refreshFeishuNotificationTargets,
  type FeishuNotificationConfig, type FeishuNotificationType } from '@/lib/feishu-notifications-api';
import { useSettingsCopy } from './settings-copy';

interface Props {available:boolean}
const key=['feishu-notification-settings'];
const deliveryKey=['feishu-notification-deliveries'];
const choiceOrder:FeishuNotificationType[]=['attention','failure','completion','lifecycle','app_action','automation'];
export function FeishuNotificationSettings({available}:Props) {
  const copy=useSettingsCopy();
  const client=useQueryClient();
  const query=useQuery({queryKey:key,queryFn:getFeishuNotificationSettings,refetchInterval:5000,refetchIntervalInBackground:false});
  const deliveries=useQuery({queryKey:deliveryKey,queryFn:getFeishuNotificationDeliveries,refetchInterval:5000,refetchIntervalInBackground:false});
  const [draft,setDraft]=useState<FeishuNotificationConfig|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [errorCode,setErrorCode]=useState('');
  const errorMessages:Record<string,string>={...copy.notifyBlockers,...copy.notifyErrors};
  const choices:{type:FeishuNotificationType;label:string}[]=choiceOrder.map(type=>({type,label:copy.notifyTypes[type]}));
  const reportError=(cause:unknown,action:string)=>{
    const code=cause instanceof GatewayApiError&&typeof cause.details?.code==='string'?cause.details.code:'';
    setErrorCode(code);
    const message=errorMessages[code]??(cause instanceof GatewayApiError&&cause.status===401
      ?copy.notifyAuthExpired:copy.notifyGenericError);
    setError(copy.notifyActionFailed(action,message));
  };
  const config=draft??query.data?.config;
  const targets=query.data?.targets??[];
  const privateTargets=targets.filter(target=>target.kind==='private'&&target.available);
  const selected=config?.targetId??(privateTargets.length===1?privateTargets[0]!.id:'');
  const selectedTarget=targets.find(target=>target.id===selected);
  const withTarget=(value:FeishuNotificationConfig,targetId=selected)=>({...value,targetId:targetId||null,identityId:targetId.startsWith('private:')?targetId.slice(8):null});
  const patch=(input:Partial<FeishuNotificationConfig>)=>{if(config)setDraft(withTarget({...config,...input},input.targetId===undefined?selected:input.targetId??''));};
  const refresh=async()=>{
    setBusy(true);setError('');setErrorCode('');setNotice('');
    try{const result=await refreshFeishuNotificationTargets();await query.refetch();setNotice(result.targets.some(target=>target.kind==='group'&&target.available)
      ?copy.notifyRefreshOk:copy.notifyRefreshNoGroup);}
    catch(cause){reportError(cause,copy.notifyActionRefresh);}
    finally{setBusy(false);}
  };
  const save=async()=>{
    if(!config)return;setBusy(true);setError('');setErrorCode('');setNotice('');
    try{const saved=await saveFeishuNotificationSettings(withTarget(config));client.setQueryData(key,saved);setDraft(null);
      setNotice(saved.config.enabled?copy.notifySavedOn:copy.notifySavedOff);await client.invalidateQueries({queryKey:deliveryKey});}
    catch(cause){reportError(cause,copy.notifyActionSave);}
    finally{setBusy(false);}
  };
  const test=async()=>{
    setBusy(true);setError('');setErrorCode('');setNotice('');
    try{await testFeishuNotification(crypto.randomUUID());setNotice(copy.notifyTestQueued);await client.invalidateQueries({queryKey:deliveryKey});}
    catch(cause){reportError(cause,copy.notifyActionTest);}
    finally{setBusy(false);}
  };
  return <Card id="feishu-notifications" className="forgebadger-animate-in">
    <SettingsCardHeader
      icon={<Bell className="size-4" />}
      title={copy.notifyTitle}
      description={copy.notifyDescription}
      action={config&&(
        <Switch
          aria-label={copy.notifySwitchAria}
          checked={config.enabled}
          disabled={busy||query.isError||(!config.enabled&&(!available||!targets.some(target=>target.available)))}
          onCheckedChange={(checked)=>patch({enabled:checked})}
        />
      )}
    />
    <CardContent className="space-y-3">
      {query.isPending && <p role="status">{copy.notifyLoading}</p>}
      {query.isError && <p role="alert">{copy.notifyLoadError}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(errorCode==='CONFIG_CONFLICT'||query.isError) && <Button variant="outline" disabled={busy} onClick={()=>{setDraft(null);setError('');setErrorCode('');void query.refetch();}}>{copy.notifyReload}</Button>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {config && <>
        <div className="space-y-1 text-sm">
          <span>{copy.notifyTargetLabel}</span>
          <Select
            value={selected}
            disabled={busy||query.isError}
            onValueChange={(value)=>patch({targetId:value||null})}
          >
            <SelectTrigger aria-label={copy.notifyTargetLabel} className="w-full min-w-0">
              <SelectValue placeholder={copy.notifyTargetPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {selected&&!selectedTarget&&<SelectItem value={selected}>{copy.notifyTargetStale}</SelectItem>}
              {targets.map(target=><SelectItem key={target.id} value={target.id} disabled={!target.available}>{target.kind==='group'?copy.notifyKindGroup:copy.notifyKindPrivate} · {target.name}{target.available?'':` · ${copy.notifyUnavailableSuffix}`}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" disabled={busy||!available} onClick={()=>void refresh()}>{copy.notifyRefreshTargets}</Button>
        <p className="text-xs text-muted-foreground">{copy.notifyPrivateHint}</p>
        {selectedTarget?.kind==='group'&&<p role="note" className="break-words text-sm">{copy.notifyGroupNotice(selectedTarget.name)}</p>}
        <p role="note" className="text-xs text-muted-foreground">{copy.notifyContentHint}</p>
        <fieldset disabled={busy||query.isError} className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 text-sm">{copy.notifyTypesLegend}</legend>
          {choices.map(choice=><label key={choice.type} className="flex items-center gap-2 text-sm"><Checkbox aria-label={choice.label} checked={config.types.includes(choice.type)}
            onCheckedChange={(checked)=>patch({types:checked===true?[...config.types,choice.type]:config.types.filter(t=>t!==choice.type)})}/>{choice.label}</label>)}
        </fieldset>
        <label className="block space-y-1 text-sm">{copy.notifyWebLabel}<Input aria-label={copy.notifyWebAria} value={config.webBaseUrl} placeholder="https://forge.example.com" disabled={busy||query.isError} onChange={e=>patch({webBaseUrl:e.target.value})}/></label>
        <p className="text-xs text-muted-foreground">{copy.notifyWebHint}</p>
        {!draft&&query.data?.blocker&&<p className="text-sm text-muted-foreground">{copy.notifyBlockers[query.data.blocker]??copy.notifyBlockerFallback}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy||query.isError||(config.enabled&&(!selectedTarget?.available||!config.types.length))} onClick={()=>void save()}>{copy.notifySave}</Button>
          <Button variant="outline" disabled={busy||!!draft||query.isError||!query.data?.config.enabled||!query.data.ready} onClick={()=>void test()}>{copy.notifyTest}</Button></div>
      </>}
      <div className="space-y-2 border-t border-border/70 pt-3 text-sm"><p>{copy.notifyDeliveriesTitle}</p>
        <p className="text-xs text-muted-foreground">{copy.notifyDeliveriesHint}</p>
        {deliveries.isPending&&<p>{copy.notifyDeliveriesLoading}</p>}{deliveries.isError&&<p role="alert">{copy.notifyDeliveriesLoadError}</p>}
        {deliveries.data?.deliveries.length===0&&<p className="text-muted-foreground">{copy.notifyDeliveriesEmpty}</p>}
        {deliveries.data?.deliveries.map(item=><div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-border/70 p-2">
          <span>{item.type==='test'?copy.notifyTestCard:choices.find(c=>c.type===item.type)?.label??copy.notifyDeliveryFallback} · {copy.notifyStatuses[item.status]??item.status}</span><time>{new Date(item.createdAt).toLocaleString()}</time>
          {item.errorCode&&errorMessages[item.errorCode]&&<p className="w-full text-xs text-muted-foreground">{errorMessages[item.errorCode]}</p>}
        </div>)}
      </div>
    </CardContent>
  </Card>;
}
