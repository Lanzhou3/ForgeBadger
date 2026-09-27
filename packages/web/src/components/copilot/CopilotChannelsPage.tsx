"use client";
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import type { ChannelPlatform } from '@/lib/api';
import { getFeishuChannelAccount, getFeishuConnectionHealth, saveFeishuChannelAccount, emergencyStopFeishu, getTelegramChannelAccount, getTelegramConnectionHealth, saveTelegramChannelAccount, getTelegramIntegrationConfig, updateTelegramIntegrationConfig, getFeishuIntegrationConfig, updateFeishuIntegrationConfig, emergencyStopTelegram, getChannelDiagnostics } from '@/lib/api';
import { getProjectOverview } from '@/lib/platform-actions-api';
import * as channels from '@/lib/copilot-channels-api';
import { ChannelBindingStep } from './ChannelBindingStep';
import { ChannelConnectionStep } from './ChannelConnectionStep';
import { ChannelDeliveries } from './ChannelDeliveries';
import { ChannelDiagnostics } from './ChannelDiagnostics';
import { ChannelPairingStep, type IssuedPairingToken } from './ChannelPairingStep';
import { ChannelStatusBanner } from './ChannelStatusBanner';
import { CopilotSettingsShell } from './copilot-settings-shell';
import { useSettingsCopy } from './settings-copy';
import { channelOverallState, channelStateLabel, channelSetupBlocker } from './channel-setup';
import { FeishuNotificationSettings } from './FeishuNotificationSettings';

const channelKey=['copilot-channels'];
const pairingKey=(p:channels.ChannelPairing|undefined)=>p?`${p.id}:${p.revision}:${p.externalUserId}:${p.chatId}`:'';

export function CopilotChannelsPage() {
  const copy=useSettingsCopy();
  const client=useQueryClient();
  const [channel,setChannel]=useState<ChannelPlatform>('feishu');
  const query=useQuery({queryKey:channelKey,queryFn:channels.getChannelRecords,refetchInterval:3000,refetchIntervalInBackground:false});
  const accountQuery=useQuery({queryKey:['copilot-channel-account',channel],queryFn:async()=>{
    if(channel==='feishu') {
      const [account,health]=await Promise.all([getFeishuChannelAccount(),getFeishuConnectionHealth()]);
      return {account,health,telegramAccount:null,telegramHealth:null};
    }
    const [telegramAccount,telegramHealth]=await Promise.all([getTelegramChannelAccount(),getTelegramConnectionHealth()]);
    return {account:null,health:null,telegramAccount,telegramHealth};
  },refetchInterval:3000,refetchIntervalInBackground:false});
  const diagnostics=useQuery({queryKey:['channel-diagnostics',channel],queryFn:()=>getChannelDiagnostics(channel),refetchInterval:5000,refetchIntervalInBackground:false});
  const integrationConfig=useQuery({queryKey:['channel-integration-config',channel],queryFn:()=>channel==='telegram'?getTelegramIntegrationConfig():getFeishuIntegrationConfig(),refetchInterval:5000,refetchIntervalInBackground:false});
  const projects=useQuery({queryKey:['project-management-overview'],queryFn:()=>getProjectOverview(),refetchInterval:15000,refetchIntervalInBackground:false});
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const [token,setToken]=useState<IssuedPairingToken&{id:string}|null>(null);
  const [identityId,setIdentityId]=useState('');const [projectId,setProjectId]=useState('');
  const [now,setNow]=useState(Date.now());
  const [failedChecks,setFailedChecks]=useState(0);
  const data=query.data && accountQuery.data ? {...query.data,...accountQuery.data} : undefined;
  const account=(channel==='feishu'?data?.account:data?.telegramAccount)??null;
  const health=(channel==='feishu'?data?.health:data?.telegramHealth)??null;
  const channelName=channel==='feishu'?'飞书':'Telegram';
  const accountId=account?.id;
  const accountRevision=account?.configRevision;
  const pairing=data?.pairings.find(p=>p.accountId===accountId && p.accountRevision===accountRevision && ['pending','claimed'].includes(p.status) && p.expiresAt>now);
  const candidate=pairingKey(pairing);
  // The 1s tick only matters while a pairing code is on screen; pause it otherwise.
  const timeSensitive=!!(pairing||token);
  useEffect(()=>{
    if(!timeSensitive)return;
    setNow(Date.now());
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[timeSensitive]);
  useEffect(()=>{if(token && (token.expiresAt<=now || (data && !data.pairings.some(p=>p.id===token.id && p.status==='pending' && p.accountRevision===accountRevision))))setToken(null);},[data,now,token,accountRevision]);
  const accountIdentities=data?.identities.filter(i=>i.accountId===accountId)??[];
  const routes=data?.routes.filter(r=>accountIdentities.some(i=>i.id===r.identityId))??[];
  const deliveries=data?.deliveries.filter(d=>d.accountId===accountId && d.channel===channel)??[];
  const identities=data?.identities.filter(i=>i.status==='active' && i.accountId===accountId && i.accountRevision===accountRevision)??[];
  const autonomyProjects=projects.data?.projects.filter(p=>p.copilotAutonomy)??[];
  const project=autonomyProjects.find(p=>p.id===projectId);
  const identity=identities.find(i=>i.id===identityId)??(identities.length===1?identities[0]:undefined);
  const integrationEnabled=!integrationConfig.isPending&&!integrationConfig.isError&&!!integrationConfig.data?.enabled&&!integrationConfig.data.emergencyDisabled;
  const canPair=!!account?.enabled&&integrationEnabled;
  const blocker=channelSetupBlocker({account,configLoading:integrationConfig.isPending,configError:integrationConfig.isError,
    config:integrationConfig.data,identities,identity,pairing,staleIdentity:accountIdentities.some(i=>i.accountRevision!==accountRevision),
    projectsLoading:projects.isPending,projectsError:projects.isError,projectCount:autonomyProjects.length,selectedProject:!!project,
    existingRoute:routes.find(r=>r.identityId===identity?.id&&r.status==='active')});
  const tokenVisible=!!token && token.expiresAt>now && (data?.pairings.some(p=>p.id===token.id && p.accountId===accountId)??false);
  const queriesError=!!(query.isError||accountQuery.isError);
  function switchChannel(value:ChannelPlatform){setChannel(value);setToken(null);setIdentityId('');setProjectId('');setError('');setSuccess('');}
  function routeState(route:channels.ChannelRoute):string {
    if(route.status!=='active')return channelStateLabel(route.status);
    const owner=data?.identities.find(i=>i.id===route.identityId);
    if(!owner || owner.status!=='active')return '身份已失效';
    if(owner.accountId!==accountId || owner.accountRevision!==accountRevision)return '配置已更新，需要重新绑定';
    if(!account?.enabled)return '渠道已停用';
    if(integrationConfig.isPending || integrationConfig.isError)return '授权状态待核查';
    if(!integrationConfig.data?.enabled || integrationConfig.data.emergencyDisabled)return '渠道已停用';
    if(projects.isPending || projects.isError)return '授权状态待核查';
    const bound=projects.data?.projects.find(p=>p.id===route.projectId);
    if(!bound)return '项目不存在';
    if(!bound.copilotAutonomy)return '项目 Copilot 自治未开启';
    if(route.authorityValid===false)return '授权已失效，请撤销后重新绑定';
    if(route.authorityValid!==true)return '授权状态待核查';
    return '权限有效';
  }
  const statusText=query.isError||accountQuery.isError||projects.isPending||projects.isError
    ? '远程操作状态待核查。'
    : routes.some(r=>routeState(r)==='权限有效')
      ? `${channelName}远程操作已授权；具体聊天仍需符合白名单，实际收发还需连接正常。`
      : routes.some(r=>routeState(r)==='授权状态待核查')?'远程操作状态待核查。'
        : `${channelName}远程操作尚未启用。${blocker?.message??'配置已就绪，请在第 3 步确认启用。'}`;
  const overall=channelOverallState({
    loadPending:queriesError||projects.isPending||projects.isError,
    authorized:routes.some(r=>routeState(r)==='权限有效'),
    pendingReview:routes.some(r=>routeState(r)==='授权状态待核查'),
    stopped:!!account?.secretConfigured&&(!account.enabled||!!integrationConfig.data?.emergencyDisabled),
    blocker,
  });
  async function refresh(){await Promise.all([client.invalidateQueries({queryKey:channelKey}),client.invalidateQueries({queryKey:['project-management-overview']}),client.invalidateQueries({queryKey:['channel-diagnostics']}),client.invalidateQueries({queryKey:['channel-integration-config']}),client.invalidateQueries({queryKey:['copilot-channel-account']})]);}
  // Do not use mutation cache: these calls can carry write-only secrets or one-time tokens.
  async function perform(action:()=>Promise<unknown>):Promise<boolean>{
    setBusy(true);setError('');setSuccess('');
    try {await action();await refresh();return true;}
    catch {setError('操作未完成。请刷新状态后重试；身份、授权或连接状态可能已变化。');setToken(null);return false;}
    finally{setBusy(false);}
  }
  const handleFailedCount=useCallback((count:number)=>setFailedChecks(count),[]);
  const projectName=(projectId:string)=>projects.data?.projects.find(p=>p.id===projectId)?.name??projectId;
  const activationReason=queriesError?'渠道状态加载失败，请重新加载后再授权。':blocker?.message??'已选择身份与项目，点击按钮后授予远程操作权限。';
  return (
    <CopilotSettingsShell active="channels" title={copy.channelsCardTitle} description={copy.channelsCardDescription}>
      <div className="flex flex-col gap-4">
        {(query.isPending || accountQuery.isPending) && <p role="status">正在加载渠道…</p>}
        {(query.isError || accountQuery.isError || projects.isError || integrationConfig.isError) && <div role="alert">加载失败。<Button variant="outline" onClick={()=>void refresh()}>重新加载</Button></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {success && <p role="status" className="text-sm">{success}</p>}
        <ChannelStatusBanner
          channel={channel}
          busy={busy}
          onSwitch={switchChannel}
          state={overall}
          statusText={statusText}
          blocker={blocker}
          failedChecks={failedChecks}
        />
        {data && <>
          <ChannelConnectionStep
            key={`connection:${channel}`}
            channel={channel}
            channelName={channelName}
            account={account}
            health={health}
            busy={busy}
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
            queriesError={queriesError}
            channelName={channelName}
            identities={identities}
            identityId={identity?.id??''}
            onIdentityChange={setIdentityId}
            autonomyProjects={autonomyProjects}
            projectId={project?.id??''}
            onProjectChange={setProjectId}
            projectsLoading={projects.isPending}
            projectsError={projects.isError}
            blocker={blocker}
            activationReason={activationReason}
            showBlockerLink={!!blocker&&blocker.step!=='authorization'}
            onActivate={()=>void perform(async()=>{
              await channels.createChannelRoute(identity!.id,project!.id);
              setSuccess('渠道绑定已创建；请以上方实时状态为准，状态正常后发送一条新消息。');
            })}
            routes={routes}
            routeState={routeState}
            projectName={projectName}
            onRevokeRoute={(id)=>void perform(()=>channels.revokeChannelRoute(id))}
          />
          {channel==='feishu' && <FeishuNotificationSettings available={canPair&&!queriesError} />}
          <ChannelDiagnostics
            channelName={channelName}
            isPending={diagnostics.isPending}
            isError={diagnostics.isError}
            checks={diagnostics.data?.checks}
            onFailedCountChange={handleFailedCount}
          />
          <ChannelDeliveries deliveries={deliveries}/>
        </>}
      </div>
    </CopilotSettingsShell>
  );
}
