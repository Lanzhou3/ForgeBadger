"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ChannelPlatform } from '@/lib/api';
import { getFeishuChannelAccount, getFeishuConnectionHealth, saveFeishuChannelAccount, emergencyStopFeishu, getTelegramChannelAccount, getTelegramConnectionHealth, saveTelegramChannelAccount, getTelegramIntegrationConfig, updateTelegramIntegrationConfig, emergencyStopTelegram, getChannelDiagnostics } from '@/lib/api';
import { getProjectOverview } from '@/lib/platform-actions-api';
import * as channels from '@/lib/copilot-channels-api';
import { CopilotManagementPanel } from './CopilotManagementPanel';
import { CopilotSettingsShell } from './copilot-settings-shell';
import { useSettingsCopy } from './settings-copy';

const channelKey=['copilot-channels'];
const states:Record<string,string>={pending:'待处理',claimed:'等待确认',confirmed:'已确认',cancelled:'已取消',active:'有效',revoked:'已撤销',sending:'发送中',delivered:'渠道已接收',failed:'发送失败',unknown:'结果不确定',connected:'已连接',connecting:'连接中',reconnecting:'重新连接中',unhealthy:'连接异常',stopped:'已停止',disabled:'未启用'};
const label=(state:string)=>states[state]??state;
const pairingKey=(p:channels.ChannelPairing|undefined)=>p?`${p.id}:${p.revision}:${p.externalUserId}:${p.chatId}`:'';

export function CopilotChannelsPage() {
  const copy=useSettingsCopy();
  const client=useQueryClient();
  const [channel,setChannel]=useState<ChannelPlatform>('feishu');
  const query=useQuery({queryKey:channelKey,queryFn:async()=>{
    const [feishuAccount,feishuHealth,telegramAccount,telegramHealth,records]=await Promise.all([getFeishuChannelAccount(),getFeishuConnectionHealth(),getTelegramChannelAccount(),getTelegramConnectionHealth(),channels.getChannelRecords()]);
    return {account:feishuAccount,health:feishuHealth,telegramAccount,telegramHealth,...records};
  },refetchInterval:3000});
  const diagnostics=useQuery({queryKey:['channel-diagnostics',channel],queryFn:()=>getChannelDiagnostics(channel),refetchInterval:5000});
  const telegramConfig=useQuery({queryKey:['telegram-channel-config'],queryFn:getTelegramIntegrationConfig,enabled:channel==='telegram',refetchInterval:5000});
  const projects=useQuery({queryKey:['project-management-overview'],queryFn:()=>getProjectOverview(),refetchInterval:15000});
  const [appId,setAppId]=useState('');const [appSecret,setAppSecret]=useState('');const [botToken,setBotToken]=useState('');
  const [whitelistDraft,setWhitelistDraft]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const [token,setToken]=useState<{id:string;value:string;expiresAt:number}|null>(null);
  const [ack,setAck]=useState('');const [identityId,setIdentityId]=useState('');const [projectId,setProjectId]=useState('');
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const data=query.data;
  const account=(channel==='feishu'?data?.account:data?.telegramAccount)??null;
  const health=(channel==='feishu'?data?.health:data?.telegramHealth)??null;
  const channelName=channel==='feishu'?'飞书':'Telegram';
  const accountId=account?.id;
  const accountRevision=account?.configRevision;
  const pairing=data?.pairings.find(p=>p.accountId===accountId && p.accountRevision===accountRevision && ['pending','claimed'].includes(p.status) && p.expiresAt>now);
  const candidate=pairingKey(pairing);
  useEffect(()=>setAck(''),[candidate]);
  useEffect(()=>{if(token && (token.expiresAt<=now || (data && !data.pairings.some(p=>p.id===token.id && p.status==='pending' && p.accountRevision===accountRevision))))setToken(null);},[data,now,token,accountRevision]);
  const identities=data?.identities.filter(i=>i.status==='active' && i.accountId===accountId && i.accountRevision===accountRevision)??[];
  const autonomyProjects=projects.data?.projects.filter(p=>p.copilotAutonomy)??[];
  const project=autonomyProjects.find(p=>p.id===projectId);
  const identity=identities.find(i=>i.id===identityId)??(identities.length===1?identities[0]:undefined);
  const idsText=telegramConfig.data?.allowedChatIds.join(', ')??'';
  const whitelistValue=whitelistDraft??idsText;
  const whitelistIds=(whitelistDraft??'').split(/[,，\s]+/).filter(Boolean).slice(0,50);
  const tokenVisible=!!token && token.expiresAt>now && (data?.pairings.some(p=>p.id===token.id && p.accountId===accountId)??false);
  function routeState(route:channels.ChannelRoute):string {
    if(route.status!=='active')return label(route.status);
    const owner=data?.identities.find(i=>i.id===route.identityId);
    if(!owner || owner.status!=='active')return '身份已失效';
    if(owner.accountId!==accountId || owner.accountRevision!==accountRevision)return '配置已更新，需要重新绑定';
    if(!account?.enabled)return '渠道已停用';
    if(projects.isPending || projects.isError)return '授权状态待核查';
    const bound=projects.data?.projects.find(p=>p.id===route.projectId);
    if(!bound)return '项目不存在';
    if(!bound.copilotAutonomy)return '项目 Copilot 自治未开启';
    return '权限有效';
  }
  async function refresh(){await Promise.all([client.invalidateQueries({queryKey:channelKey}),client.invalidateQueries({queryKey:['project-management-overview']}),client.invalidateQueries({queryKey:['channel-diagnostics']}),client.invalidateQueries({queryKey:['telegram-channel-config']})]);}
  // Do not use mutation cache: these calls can carry write-only secrets or one-time tokens.
  async function perform(action:()=>Promise<unknown>){
    setBusy(true);setError('');setSuccess('');
    try {await action();await refresh();}
    catch {setError('操作未完成。请刷新状态后重试；身份、授权或连接状态可能已变化。');setToken(null);setAck('');}
    finally{setBusy(false);setAppSecret('');setBotToken('');}
  }
  return (
    <CopilotSettingsShell active="channels" title={copy.channelsCardTitle} description={copy.channelsCardDescription}>
      <div className="flex flex-col gap-4">
        {query.isPending && <p role="status">正在加载渠道…</p>}
        {(query.isError || projects.isError) && <div role="alert">加载失败。<Button variant="outline" onClick={()=>{void query.refetch();void projects.refetch();}}>重新加载</Button></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {success && <p role="status" className="text-sm">{success}</p>}
        {data && <>
          <div role="status" className="rounded-md border border-border p-3 text-sm">
            {projects.isPending || projects.isError
              ? '远程操作状态待核查。'
              : data.routes.some(r => routeState(r) === '权限有效')
                ? channel==='feishu' ? '飞书远程操作已授权；实际收发还需连接正常。' : 'Telegram 远程操作已授权；实际收发还需连接正常。'
                : channel==='feishu' ? '飞书远程操作尚未启用：请在第 3 步选择已开启 Copilot 自治的项目，并点击“启用飞书远程操作”。' : 'Telegram 远程操作尚未启用：请在第 3 步选择已开启 Copilot 自治的项目，并点击“启用 Telegram 远程操作”。'}
          </div>
          <Card><CardHeader><CardTitle>渠道诊断 · {channelName}</CardTitle></CardHeader><CardContent className="space-y-2">
            {diagnostics.isPending && <p role="status">正在检查渠道状态…</p>}
            {diagnostics.isError && <p role="alert">诊断加载失败，稍后自动重试。</p>}
            {!diagnostics.isPending && !diagnostics.isError && !diagnostics.data?.checks.length && <p className="text-sm text-muted-foreground">暂无诊断项。</p>}
            {diagnostics.data?.checks.map(c=><div key={c.key} className="rounded-md border border-border/70 p-3 text-sm"><p>{c.ok?'✓':'✗'} {c.detail}</p>{!c.ok && c.fixHint && <p className="text-xs text-muted-foreground">建议：{c.fixHint}</p>}</div>)}
          </CardContent></Card>
          <div className="flex gap-2">
            <Button size="sm" variant={channel==='feishu'?'default':'outline'} onClick={()=>setChannel('feishu')}>飞书</Button>
            <Button size="sm" variant={channel==='telegram'?'default':'outline'} onClick={()=>setChannel('telegram')}>Telegram</Button>
          </div>
          {channel==='feishu' ? (
          <Card><CardHeader><CardTitle>1. 接入飞书应用</CardTitle></CardHeader><CardContent className="space-y-3">
            <p role="status">连接：{label(health?.state??'disabled')} · {data.account?.secretConfigured?'凭证已保存':'尚未配置凭证'}</p>
            {health?.lastConnectedAt && <p className="text-xs text-muted-foreground">最近连接：{new Date(health.lastConnectedAt).toLocaleString()}</p>}
            {health?.lastErrorMessage && <p className="text-xs text-muted-foreground">最近错误：{health.lastErrorMessage}</p>}
            <p className="text-sm text-muted-foreground">保存应用会更新配置版本，已有身份和渠道授权将失效，需要重新配对和绑定。</p>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();const submittedSecret=appSecret;setAppSecret('');setToken(null);void perform(()=>saveFeishuChannelAccount({appId:appId||data.account?.appId||'',enabled:true,...(submittedSecret?{appSecret:submittedSecret}:{})}));}}>
              <label className="space-y-1 text-sm">App ID<Input aria-label="App ID" autoComplete="off" value={appId} placeholder={data.account?.appId??'cli_…'} onChange={e=>setAppId(e.target.value)} /></label>
              <label className="space-y-1 text-sm">App Secret<Input aria-label="App Secret" type="password" autoComplete="new-password" value={appSecret} placeholder={data.account?.secretConfigured?'留空保留已保存密钥':'输入应用密钥'} onChange={e=>setAppSecret(e.target.value)} /></label>
              <Button type="submit" disabled={busy||!(appId||data.account?.appId)||(!data.account?.secretConfigured&&!appSecret)}>保存并启用</Button>
              <Button type="button" variant="destructive" disabled={busy||!data.account} onClick={()=>{setToken(null);void perform(emergencyStopFeishu);}}>紧急停止飞书</Button>
            </form>
            <p className="text-xs text-muted-foreground">紧急停止阻止后续入站和操作；已经发生的操作无法撤回。飞书开放平台需要开启机器人和消息接收事件。</p>
          </CardContent></Card>
          ) : (
          <Card><CardHeader><CardTitle>1. 接入 Telegram 机器人</CardTitle></CardHeader><CardContent className="space-y-3">
            <p role="status">连接：{label(health?.state??'disabled')} · {data.telegramAccount?.secretConfigured?'Bot Token 已保存':'尚未配置 Bot Token'}</p>
            {health?.lastConnectedAt && <p className="text-xs text-muted-foreground">最近连接：{new Date(health.lastConnectedAt).toLocaleString()}</p>}
            {health?.lastErrorMessage && <p className="text-xs text-muted-foreground">最近错误：{health.lastErrorMessage}</p>}
            {data.telegramAccount?.botUsername && <p className="text-sm">机器人：@{data.telegramAccount.botUsername}</p>}
            <p className="text-sm text-muted-foreground">使用 @BotFather 创建机器人并复制 Bot Token。保存会更新配置版本，已有身份和渠道授权将失效，需要重新配对和绑定。</p>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();const submittedToken=botToken;setBotToken('');setToken(null);void perform(()=>saveTelegramChannelAccount({enabled:true,...(submittedToken?{botToken:submittedToken}:{})}));}}>
              <label className="space-y-1 text-sm">Bot Token<Input aria-label="Bot Token" type="password" autoComplete="new-password" value={botToken} placeholder={data.telegramAccount?.secretConfigured?'留空保留已保存 Token':'123456:ABC-DEF…'} onChange={e=>setBotToken(e.target.value)} /></label>
              <Button type="submit" disabled={busy||(!botToken&&!data.telegramAccount?.secretConfigured)}>保存并启用</Button>
              <Button type="button" variant="destructive" disabled={busy||!data.telegramAccount} onClick={()=>{setToken(null);void perform(emergencyStopTelegram);}}>紧急停止 Telegram</Button>
            </form>
            <p className="text-xs text-muted-foreground">紧急停止阻止后续入站和操作；已经发生的操作无法撤回。Telegram 机器人通过长轮询接收消息，无需公网回调地址。</p>
          </CardContent></Card>
          )}
          <Card><CardHeader><CardTitle>2. 确认私聊身份</CardTitle></CardHeader><CardContent className="space-y-3">
            <Button disabled={busy||!account?.enabled} onClick={()=>void perform(async()=>{setToken(null);const issued=await channels.createChannelPairing(account!.id,channel);await refresh();setToken({id:issued.pairing.id,value:issued.token,expiresAt:issued.pairing.expiresAt});})}>生成新的配对码</Button>
            {tokenVisible && <div className="space-y-2 rounded-md border border-border p-3"><p className="text-sm">向{channelName}机器人私聊发送以下命令，请勿转发。到期：{new Date(token!.expiresAt).toLocaleTimeString()}</p><code className="block break-all select-all">/pair {token!.value}</code></div>}
            {!pairing && <p className="text-sm text-muted-foreground">没有待确认配对。新配对码会使旧码失效。</p>}
            {pairing?.status==='pending' && <p role="status">等待{channelName}私聊认领… 配对码仅在生成时显示，刷新页面后可重新生成。</p>}
            {pairing?.status==='claimed' && <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm">请核对认领者，勾选后确认；系统不会自动绑定身份。</p>
              <dl className="break-all text-sm"><dt>{channel==='feishu'?'飞书用户 ID':'Telegram 用户 ID'}</dt><dd>{pairing.externalUserId}</dd><dt className="mt-2">{channel==='feishu'?'私聊 ID':'会话 ID'}</dt><dd>{pairing.chatId}</dd></dl>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack===candidate} onChange={e=>setAck(e.target.checked?candidate:'')} />我确认这是自己的{channelName}私聊</label>
              <Button disabled={busy||ack!==candidate} onClick={()=>void perform(async()=>{setAck('');setToken(null);await channels.confirmChannelPairing(pairing);})}>确认身份</Button>
            </div>}
            {pairing && <Button variant="outline" disabled={busy} onClick={()=>{setToken(null);setAck('');void perform(()=>channels.cancelChannelPairing(pairing.id));}}>取消本次配对</Button>}
            {data.identities.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-3 text-sm"><span className="break-all">{i.externalUserId} · {label(i.status)}{i.accountRevision!==accountRevision?' · 配置已更新，请重新配对':''}</span><Button variant="outline" size="sm" disabled={busy||i.status!=='active'} onClick={()=>void perform(()=>channels.revokeChannelIdentity(i.id))}>撤销身份</Button></div>)}
            {channel==='telegram' && <div className="space-y-2 rounded-md border border-border/70 p-3">
              <p className="text-sm">群聊白名单</p>
              <p className="text-xs text-muted-foreground">群聊默认拒绝；加入白名单后，机器人在该群内被 @ 才会响应。注意：白名单非空时，不在名单内的私聊也会被拒绝，需要把自己的私聊 ID 一并加入。</p>
              <label className="block space-y-1 text-sm">群聊与私聊 ID（逗号分隔，最多 50 个）<Input aria-label="群聊白名单" value={whitelistValue} placeholder="例如：-1001234567890,123456789" onChange={e=>setWhitelistDraft(e.target.value)} /></label>
              <Button type="button" variant="outline" disabled={busy||whitelistDraft===null||whitelistDraft===idsText} onClick={()=>void perform(async()=>{await updateTelegramIntegrationConfig({allowedChatIds:whitelistIds});setWhitelistDraft(null);})}>保存白名单</Button>
            </div>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>3. 绑定项目与操作授权</CardTitle></CardHeader><CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">绑定会创建独立会话。授权范围就是所选项目：项目的 Copilot 自治开关开启时渠道消息可直接执行，关闭后立即停止受理。</p>
            <details className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm">管理项目 Copilot 自治开关</summary><CopilotManagementPanel /></details>
            {projects.isPending && <p role="status">正在加载项目…</p>}
            {!projects.isPending && !autonomyProjects.length && <p className="text-sm">尚无已开启 Copilot 自治的项目，请先在上方打开项目开关。</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">私聊身份<select aria-label="私聊身份" className="w-full rounded-md border border-border bg-background p-2" value={identity?.id??''} onChange={e=>setIdentityId(e.target.value)}><option value="">选择已确认身份</option>{identities.map(i=><option key={i.id} value={i.id}>{i.externalUserId}</option>)}</select></label>
              <label className="space-y-1 text-sm">项目<select aria-label="项目" className="w-full rounded-md border border-border bg-background p-2" value={project?.id??''} onChange={e=>setProjectId(e.target.value)}><option value="">选择已开启自治的项目</option>{autonomyProjects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </div>
            <Button disabled={busy||!project||!identity||data.routes.some(r=>r.identityId===identity.id&&r.status==='active')} onClick={()=>void perform(async()=>{await channels.createChannelRoute(identity!.id,project!.id);setSuccess("渠道绑定已创建；请以上方实时状态为准，状态正常后发送一条新消息。");})}>启用{channelName}远程操作</Button>
            {data.routes.map(r=><div key={r.id} className="space-y-2 rounded-md border border-border/70 p-3 text-sm"><p>{projects.data?.projects.find(p=>p.id===r.projectId)?.name??r.projectId} · {routeState(r)}</p><p className="break-all text-xs text-muted-foreground">独立会话：{r.conversationId}</p><Link className="inline-block underline underline-offset-4" href={`/copilot?c=${encodeURIComponent(r.conversationId)}`}>打开会话</Link><Button variant="outline" size="sm" disabled={busy||r.status!=='active'} onClick={()=>void perform(()=>channels.revokeChannelRoute(r.id))}>撤销渠道绑定</Button></div>)}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>最近结果回传</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">“渠道已接收”不代表已读。“结果不确定”可能已经送达，请先核对飞书或 Telegram；系统不会自动重发。</p>
            {!data.deliveries.length && <p>暂无回传记录。</p>}
            {data.deliveries.map(d=><div key={d.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-border/70 p-3"><span>{d.phase==='terminal'?'任务结果':'状态提示'} · {label(d.status)}</span><time>{new Date(d.createdAt).toLocaleString()}</time></div>)}
          </CardContent></Card>
        </>}
      </div>
    </CopilotSettingsShell>
  );
}
