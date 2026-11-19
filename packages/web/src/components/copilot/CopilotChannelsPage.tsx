"use client";
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTrilingual } from '@/hooks/use-trilingual';
import type { ChannelPlatform } from '@/lib/api';
import { getFeishuChannelAccount, getFeishuConnectionHealth, saveFeishuChannelAccount, emergencyStopFeishu, getTelegramChannelAccount, getTelegramConnectionHealth, saveTelegramChannelAccount, getTelegramIntegrationConfig, updateTelegramIntegrationConfig, getFeishuIntegrationConfig, updateFeishuIntegrationConfig, emergencyStopTelegram, getChannelDiagnostics } from '@/lib/api';
import * as channels from '@/lib/copilot-channels-api';
import { ChannelBindingStep } from './ChannelBindingStep';
import { ChannelConnectionStep } from './ChannelConnectionStep';
import { ChannelDeliveries } from './ChannelDeliveries';
import { ChannelDiagnostics } from './ChannelDiagnostics';
import { ChannelPairingStep, type IssuedPairingToken } from './ChannelPairingStep';
import { ChannelStatusBanner } from './ChannelStatusBanner';
import { CopilotSettingsShell } from './copilot-settings-shell';
import { useSettingsCopy } from './settings-copy';
import { channelOverallState, channelSetupBlocker, type ChannelRouteStateKey } from './channel-setup';
import { FeishuNotificationSettings } from './FeishuNotificationSettings';
import { TelegramNotificationSettings } from './TelegramNotificationSettings';

const channelKey=['copilot-channels'];
const pairingKey=(p:channels.ChannelPairing|undefined)=>p?`${p.id}:${p.revision}:${p.externalUserId}:${p.chatId}`:'';

export function CopilotChannelsPage() {
  const copy=useSettingsCopy();
  const t3=useTrilingual();
  const client=useQueryClient();
  const [channel,setChannel]=useState<ChannelPlatform>('feishu');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const [token,setToken]=useState<IssuedPairingToken&{id:string}|null>(null);
  const [identityId,setIdentityId]=useState('');
  const [now,setNow]=useState(Date.now());
  const [failedChecks,setFailedChecks]=useState(0);

  const accountQuery=useQuery({
    queryKey:['copilot-channel-account',channel],
    queryFn:async()=>{
      if(channel==='feishu') {
        const [account,health]=await Promise.all([getFeishuChannelAccount(),getFeishuConnectionHealth()]);
        return {account,health,telegramAccount:null,telegramHealth:null};
      }
      const [telegramAccount,telegramHealth]=await Promise.all([getTelegramChannelAccount(),getTelegramConnectionHealth()]);
      return {account:null,health:null,telegramAccount,telegramHealth};
    },
    refetchInterval:(q)=>{
      const snapshot=q.state.data;
      const acc=channel==='feishu'?snapshot?.account:snapshot?.telegramAccount;
      const h=channel==='feishu'?snapshot?.health:snapshot?.telegramHealth;
      if(!acc?.secretConfigured)return false;
      const records=client.getQueryData<Awaited<ReturnType<typeof channels.getChannelRecords>>>(channelKey);
      const hasActivePairing=Boolean(token||records?.pairings.some(p=>p.accountId===acc.id&&p.accountRevision===acc.configRevision&&['pending','claimed'].includes(p.status)&&p.expiresAt>Date.now()));
      if(hasActivePairing||h?.state==='connecting'||h?.state==='reconnecting')return 3000;
      return 15000;
    },
    refetchIntervalInBackground:false,
  });

  const accountData=accountQuery.data;
  const account=(channel==='feishu'?accountData?.account:accountData?.telegramAccount)??null;
  const health=(channel==='feishu'?accountData?.health:accountData?.telegramHealth)??null;
  const isConfigured=Boolean(account?.secretConfigured);
  const isConnecting=health?.state==='connecting'||health?.state==='reconnecting';

  const query=useQuery({
    queryKey:channelKey,
    queryFn:channels.getChannelRecords,
    refetchInterval:(q)=>{
      if(!isConfigured)return false;
      const accId=account?.id;
      const accRev=account?.configRevision;
      const hasActivePairing=Boolean(token||q.state.data?.pairings.some(p=>p.accountId===accId&&p.accountRevision===accRev&&['pending','claimed'].includes(p.status)&&p.expiresAt>Date.now()));
      if(hasActivePairing||isConnecting)return 3000;
      return 15000;
    },
    refetchIntervalInBackground:false,
  });

  const data=query.data && accountQuery.data ? {...query.data,...accountQuery.data} : undefined;
  const channelName=channel==='feishu'?copy.channelNameFeishu:copy.channelNameTelegram;
  const accountId=account?.id;
  const accountRevision=account?.configRevision;
  const pairing=data?.pairings.find(p=>p.accountId===accountId && p.accountRevision===accountRevision && ['pending','claimed'].includes(p.status) && p.expiresAt>now);
  const candidate=pairingKey(pairing);
  const timeSensitive=!!(pairing||token);

  const diagnostics=useQuery({
    queryKey:['channel-diagnostics',channel],
    queryFn:()=>getChannelDiagnostics(channel),
    refetchInterval:()=>!isConfigured?false:(timeSensitive||isConnecting?3000:15000),
    refetchIntervalInBackground:false,
  });
  const integrationConfig=useQuery({
    queryKey:['channel-integration-config',channel],
    queryFn:()=>channel==='telegram'?getTelegramIntegrationConfig():getFeishuIntegrationConfig(),
    refetchInterval:()=>isConfigured?15000:false,
    refetchIntervalInBackground:false,
  });

  useEffect(()=>{
    if(!timeSensitive)return;
    setNow(Date.now());
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[timeSensitive]);
  useEffect(()=>{if(token && (token.expiresAt<=now || (data && !data.pairings.some(p=>p.id===token.id && p.status==='pending' && p.accountRevision===accountRevision))))setToken(null);},[data,now,token,accountRevision]);
  const accountIdentities=data?.identities.filter(i=>i.accountId===accountId&&i.status==='active')??[];
  const routes=data?.routes.filter(r=>r.status==='active'&&accountIdentities.some(i=>i.id===r.identityId))??[];
  const deliveries=data?.deliveries.filter(d=>d.accountId===accountId && d.channel===channel)??[];
  const identities=accountIdentities.filter(i=>i.accountRevision===accountRevision);
  const identity=identities.find(i=>i.id===identityId)??(identities.length===1?identities[0]:undefined);
  const integrationEnabled=!integrationConfig.isPending&&!integrationConfig.isError&&!!integrationConfig.data?.enabled&&!integrationConfig.data.emergencyDisabled;
  const canPair=!!account?.enabled&&integrationEnabled;
  const blocker=channelSetupBlocker({account,configLoading:integrationConfig.isPending,configError:integrationConfig.isError,
    config:integrationConfig.data,identities,identity,pairing,staleIdentity:accountIdentities.some(i=>i.accountRevision!==accountRevision),
    existingRoute:routes.find(r=>r.identityId===identity?.id)},copy.channelSetup);
  const tokenVisible=!!token && token.expiresAt>now && (data?.pairings.some(p=>p.id===token.id && p.accountId===accountId)??false);
  const queriesError=!!(query.isError||accountQuery.isError);
  function switchChannel(value:ChannelPlatform){setChannel(value);setToken(null);setIdentityId('');setError('');setSuccess('');}
  function routeStateKey(route:channels.ChannelRoute):ChannelRouteStateKey|null {
    if(route.status!=='active')return null;
    const owner=data?.identities.find(i=>i.id===route.identityId);
    if(!owner || owner.status!=='active')return 'identity_inactive';
    if(owner.accountId!==accountId || owner.accountRevision!==accountRevision)return 'config_changed';
    if(!account?.enabled)return 'channel_disabled';
    if(integrationConfig.isPending || integrationConfig.isError)return 'pending_review';
    if(!integrationConfig.data?.enabled || integrationConfig.data.emergencyDisabled)return 'channel_disabled';
    if(route.authorityValid===false)return 'authority_revoked';
    if(route.authorityValid!==true)return 'pending_review';
    return 'authorized';
  }
  const authorized=routes.some(r=>routeStateKey(r)==='authorized');
  const pendingReview=routes.some(r=>routeStateKey(r)==='pending_review');
  const statusText=query.isError||accountQuery.isError||integrationConfig.isPending||integrationConfig.isError
    ? copy.channelStatusPending
    : authorized
      ? copy.channelStatusAuthorized(channelName)
      : pendingReview
        ? copy.channelStatusPending
        : copy.channelStatusNotEnabled(channelName,blocker?.message??copy.channelReadyHint);
  const overall=channelOverallState({
    loadPending:queriesError||integrationConfig.isPending||integrationConfig.isError,
    authorized,
    pendingReview,
    stopped:!!account?.secretConfigured&&(!account.enabled||!!integrationConfig.data?.emergencyDisabled),
    blocker,
  });
  async function refresh(){await Promise.all([client.invalidateQueries({queryKey:channelKey}),client.invalidateQueries({queryKey:['channel-diagnostics']}),client.invalidateQueries({queryKey:['channel-integration-config']}),client.invalidateQueries({queryKey:['copilot-channel-account']})]);}
  async function perform(action:()=>Promise<unknown>):Promise<boolean>{
    setBusy(true);setError('');setSuccess('');
    try {await action();await refresh();return true;}
    catch {setError(copy.actionFailedError);setToken(null);return false;}
    finally{setBusy(false);}
  }
  const handleFailedCount=useCallback((count:number)=>setFailedChecks(count),[]);
  const activationReason=queriesError?copy.activationLoadError:blocker?.message??copy.activationReady;
  const step1Completed=isConfigured&&canPair;
  const step2Completed=identities.length>0;
  const step3Completed=authorized;

  return (
    <CopilotSettingsShell active="channels" title={copy.channelsCardTitle} description={copy.channelsCardDescription}>
      <div className="flex flex-col gap-4">
        {(query.isError || accountQuery.isError || integrationConfig.isError) && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{copy.loadFailed}<Button size="sm" variant="outline" onClick={()=>void refresh()}>{copy.reloadAction}</Button></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {success && <p role="status" className="text-sm text-muted-foreground">{success}</p>}
        <ChannelStatusBanner
          channel={channel}
          busy={busy}
          onSwitch={switchChannel}
          state={overall}
          statusText={statusText}
          blocker={blocker}
          failedChecks={failedChecks}
        />
        {(query.isPending || accountQuery.isPending) && <ChannelsSkeleton label={copy.channelsLoading} />}
        {data && <>
          <ChannelConnectionStep
            key={`connection:${channel}`}
            channel={channel}
            channelName={channelName}
            account={account}
            health={health}
            busy={busy}
            completed={step1Completed}
            onSaveFeishu={(appId,appSecret)=>{setToken(null);return perform(()=>saveFeishuChannelAccount({appId,enabled:true,...(appSecret?{appSecret}:{})}));}}
            onSaveTelegram={(botToken)=>{setToken(null);return perform(()=>saveTelegramChannelAccount({enabled:true,...(botToken?{botToken}:{})}));}}
            onEmergencyStop={()=>{setToken(null);void perform(channel==='feishu'?emergencyStopFeishu:emergencyStopTelegram);}}
          />
          <ChannelPairingStep
            key={`pairing:${channel}`}
            channel={channel}
            channelName={channelName}
            busy={busy}
            canPair={canPair}
            completed={step2Completed}
            muted={!isConfigured}
            queriesError={queriesError}
            pairing={pairing}
            token={tokenVisible&&token?{value:token.value,expiresAt:token.expiresAt}:null}
            candidate={candidate}
            accountIdentities={accountIdentities}
            accountRevision={accountRevision}
            onCreatePairing={()=>void perform(async()=>{
              setToken(null);
              const issued=await channels.createChannelPairing(account!.id,channel);
              await refresh();
              setToken({id:issued.pairing.id,value:issued.token,expiresAt:issued.pairing.expiresAt});
            })}
            onConfirmPairing={(pairing)=>void perform(async()=>{setToken(null);await channels.confirmChannelPairing(pairing);})}
            onCancelPairing={(id)=>{setToken(null);void perform(()=>channels.cancelChannelPairing(id));}}
            onRevokeIdentity={(id)=>void perform(()=>channels.revokeChannelIdentity(id))}
            whitelistIdsText={integrationConfig.data?.allowedChatIds.join(', ')??''}
            whitelistLoading={integrationConfig.isPending}
            whitelistError={integrationConfig.isError}
            onSaveWhitelist={(ids)=>perform(async()=>{
              await (channel==='telegram'?updateTelegramIntegrationConfig:updateFeishuIntegrationConfig)({allowedChatIds:ids});
            })}
          />
          <ChannelBindingStep
            key={`binding:${channel}`}
            busy={busy}
            completed={step3Completed}
            muted={!isConfigured}
            queriesError={queriesError}
            channelName={channelName}
            identities={identities}
            identityId={identity?.id??''}
            onIdentityChange={setIdentityId}
            blocker={blocker}
            activationReason={activationReason}
            showBlockerLink={!!blocker&&blocker.step!=='authorization'}
            onActivate={()=>void perform(async()=>{
              await channels.createChannelRoute(identity!.id);
              setSuccess(copy.bindingCreated);
            })}
            routes={routes}
            routeState={routeStateKey}
            onRevokeRoute={(id)=>void perform(()=>channels.revokeChannelRoute(id))}
          />
          {channel==='feishu' && <FeishuNotificationSettings available={canPair&&!queriesError} />}
          {channel==='telegram' && <TelegramNotificationSettings available={canPair&&!queriesError} />}
          <section className="space-y-3 pt-1">
            <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground">
              {t3("运维与诊断", "運維與診斷", "Operations & diagnostics")}
            </h2>
            <ChannelDiagnostics
              channelName={channelName}
              isPending={diagnostics.isPending}
              isError={diagnostics.isError}
              checks={diagnostics.data?.checks}
              onFailedCountChange={handleFailedCount}
            />
            <ChannelDeliveries deliveries={deliveries}/>
          </section>
        </>}
      </div>
    </CopilotSettingsShell>
  );
}

function ChannelsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((index) => (
        <Card key={index} className="gap-0 overflow-hidden py-0 shadow-none">
          <div className="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-5">
            <div className="size-7 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-5 w-16 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="space-y-2 border-t border-border/70 px-4 py-4 sm:px-5">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/70" />
            <div className="h-9 w-full animate-pulse rounded bg-muted/50" />
          </div>
        </Card>
      ))}
    </div>
  );
}
