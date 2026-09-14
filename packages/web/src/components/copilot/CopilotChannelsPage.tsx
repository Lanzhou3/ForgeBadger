"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getFeishuChannelAccount, getFeishuConnectionHealth, saveFeishuChannelAccount, emergencyStopFeishu } from '@/lib/api';
import { listGrants, getProjectOverview } from '@/lib/platform-actions-api';
import * as channels from '@/lib/copilot-channels-api';
import { CopilotManagementPanel } from './CopilotManagementPanel';

const channelKey=['copilot-channels'];
const states:Record<string,string>={pending:'待处理',claimed:'等待确认',confirmed:'已确认',cancelled:'已取消',active:'有效',revoked:'已撤销',sending:'发送中',delivered:'飞书已接收',failed:'发送失败',unknown:'结果不确定',connected:'已连接',connecting:'连接中',reconnecting:'重新连接中',unhealthy:'连接异常',stopped:'已停止',disabled:'未启用'};
const label=(state:string)=>states[state]??state;
const pairingKey=(p:channels.ChannelPairing|undefined)=>p?`${p.id}:${p.revision}:${p.externalUserId}:${p.chatId}`:'';

export function CopilotChannelsPage() {
  const client=useQueryClient();
  const query=useQuery({queryKey:channelKey,queryFn:async()=>{
    const [account,health,records]=await Promise.all([getFeishuChannelAccount(),getFeishuConnectionHealth(),channels.getChannelRecords()]);
    return {account,health,...records};
  },refetchInterval:3000});
  const grants=useQuery({queryKey:['copilot-grants'],queryFn:listGrants,refetchInterval:15000});
  const projects=useQuery({queryKey:['project-management-overview'],queryFn:()=>getProjectOverview()});
  const [appId,setAppId]=useState('');const [secret,setSecret]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const [token,setToken]=useState<{id:string;value:string;expiresAt:number}|null>(null);
  const [ack,setAck]=useState('');const [identityId,setIdentityId]=useState('');const [grantId,setGrantId]=useState('');
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const data=query.data;
  const pairing=data?.pairings.find(p=>p.accountId===data.account?.id && p.accountRevision===data.account?.configRevision && ['pending','claimed'].includes(p.status) && p.expiresAt>now);
  const candidate=pairingKey(pairing);
  useEffect(()=>setAck(''),[candidate]);
  useEffect(()=>{if(token && (token.expiresAt<=now || (data && !data.pairings.some(p=>p.id===token.id && p.status==='pending' && p.accountRevision===data.account?.configRevision))))setToken(null);},[data,now,token]);
  const identities=data?.identities.filter(i=>i.status==='active' && i.accountId===data.account?.id && i.accountRevision===data.account?.configRevision)??[];
  const validGrants=grants.data?.grants.filter(g=>g.status==='active' && (g.expiresAt===null || g.expiresAt>now) && (g.maxActions===null || g.usedActions<g.maxActions))??[];
  const grant=validGrants.find(g=>g.id===grantId);
  const identity=identities.find(i=>i.id===identityId)??(identities.length===1?identities[0]:undefined);
  function routeState(route:channels.ChannelRoute):string {
    if(route.status!=='active')return label(route.status);
    const owner=data?.identities.find(i=>i.id===route.identityId);
    if(!owner || owner.status!=='active')return '身份已失效';
    if(owner.accountId!==data?.account?.id || owner.accountRevision!==data?.account?.configRevision)return '配置已更新，需要重新绑定';
    if(!data.account.enabled)return '渠道已停用';
    if(grants.isPending || grants.isError)return '授权状态待核查';
    const bound=grants.data?.grants.find(g=>g.id===route.grantId);
    if(!bound || bound.status!=='active' || bound.revision!==route.grantRevision || (bound.expiresAt!==null && bound.expiresAt<=now) || (bound.maxActions!==null && bound.usedActions>=bound.maxActions))return '授权已失效';
    return '权限有效';
  }
  async function refresh(){await Promise.all([client.invalidateQueries({queryKey:channelKey}),client.invalidateQueries({queryKey:['copilot-grants']})]);}
  // Do not use mutation cache: these calls can carry write-only secrets or one-time tokens.
  async function perform(action:()=>Promise<unknown>){
    setBusy(true);setError('');setSuccess('');
    try {await action();await refresh();}
    catch {setError('操作未完成。请刷新状态后重试；身份、授权或连接状态可能已变化。');setToken(null);setAck('');}
    finally{setBusy(false);setSecret('');}
  }
  return <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
    <header className="pl-12 md:pl-0"><Link href="/copilot/settings" className="text-sm text-muted-foreground">← Copilot 设置</Link><h1 className="mt-2 text-xl font-semibold">远程渠道</h1><p className="mt-1 text-sm text-muted-foreground">通过飞书私聊操作已授权项目。身份确认和项目授权缺一不可。</p></header>
    {query.isPending && <p role="status">正在加载渠道…</p>}
    {(query.isError || grants.isError) && <div role="alert">加载失败。<Button variant="outline" onClick={()=>{void query.refetch();void grants.refetch();}}>重新加载</Button></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {success && <p role="status" className="text-sm">{success}</p>}
    {data && <>
      <div role="status" className="rounded-md border border-border p-3 text-sm">
        {grants.isPending || grants.isError ? '远程操作状态待核查。' : data.routes.some(r => routeState(r) === '权限有效')
          ? '飞书远程操作已授权；实际收发还需连接正常。'
          : '飞书远程操作尚未启用：请在第 3 步选择有效项目授权，并点击“启用飞书远程操作”。仅创建项目授权不会启用飞书。'}
      </div>
      <Card><CardHeader><CardTitle>1. 飞书应用</CardTitle></CardHeader><CardContent className="space-y-3">
        <p role="status">连接：{label(data.health.state)} · {data.account?.secretConfigured?'凭证已保存':'尚未配置凭证'}</p>
        <p className="text-sm text-muted-foreground">保存应用会更新配置版本，已有身份和渠道授权将失效，需要重新配对和绑定。</p>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();const submittedSecret=secret;setSecret('');setToken(null);void perform(()=>saveFeishuChannelAccount({appId:appId||data.account?.appId||'',enabled:true,...(submittedSecret?{appSecret:submittedSecret}:{})}));}}>
          <label className="space-y-1 text-sm">App ID<Input aria-label="App ID" autoComplete="off" value={appId} placeholder={data.account?.appId??'cli_…'} onChange={e=>setAppId(e.target.value)} /></label>
          <label className="space-y-1 text-sm">App Secret<Input aria-label="App Secret" type="password" autoComplete="new-password" value={secret} placeholder={data.account?.secretConfigured?'留空保留已保存密钥':'输入应用密钥'} onChange={e=>setSecret(e.target.value)} /></label>
          <Button type="submit" disabled={busy||!(appId||data.account?.appId)||(!data.account?.secretConfigured&&!secret)}>保存并启用</Button>
          <Button type="button" variant="destructive" disabled={busy||!data.account} onClick={()=>{setToken(null);void perform(emergencyStopFeishu);}}>紧急停止飞书</Button>
        </form>
        <p className="text-xs text-muted-foreground">紧急停止阻止后续入站和操作；已经发生的操作无法撤回。飞书开放平台需要开启机器人和消息接收事件。</p>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>2. 确认私聊身份</CardTitle></CardHeader><CardContent className="space-y-3">
        <Button disabled={busy||!data.account?.enabled} onClick={()=>void perform(async()=>{setToken(null);const issued=await channels.createChannelPairing(data.account!.id);await refresh();setToken({id:issued.pairing.id,value:issued.token,expiresAt:issued.pairing.expiresAt});})}>生成新的配对码</Button>
        {token && token.expiresAt>now && <div className="space-y-2 rounded-md border border-border p-3"><p className="text-sm">向本应用机器人私聊发送以下命令，请勿转发。到期：{new Date(token.expiresAt).toLocaleTimeString()}</p><code className="block break-all select-all">/pair {token.value}</code></div>}
        {!pairing && <p className="text-sm text-muted-foreground">没有待确认配对。新配对码会使旧码失效。</p>}
        {pairing?.status==='pending' && <p role="status">等待飞书私聊认领… 配对码仅在生成时显示，刷新页面后可重新生成。</p>}
        {pairing?.status==='claimed' && <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm">请核对认领者，勾选后确认；系统不会自动绑定身份。</p>
          <dl className="break-all text-sm"><dt>飞书用户 ID</dt><dd>{pairing.externalUserId}</dd><dt className="mt-2">私聊 ID</dt><dd>{pairing.chatId}</dd></dl>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack===candidate} onChange={e=>setAck(e.target.checked?candidate:'')} />我确认这是自己的飞书私聊</label>
          <Button disabled={busy||ack!==candidate} onClick={()=>void perform(async()=>{setAck('');setToken(null);await channels.confirmChannelPairing(pairing);})}>确认身份</Button>
        </div>}
        {pairing && <Button variant="outline" disabled={busy} onClick={()=>{setToken(null);setAck('');void perform(()=>channels.cancelChannelPairing(pairing.id));}}>取消本次配对</Button>}
        {data.identities.map(i=><div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 p-3 text-sm"><span className="break-all">{i.externalUserId} · {label(i.status)}{i.accountRevision!==data.account?.configRevision?' · 配置已更新，请重新配对':''}</span><Button variant="outline" size="sm" disabled={busy||i.status!=='active'} onClick={()=>void perform(()=>channels.revokeChannelIdentity(i.id))}>撤销身份</Button></div>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>3. 绑定项目与操作授权</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">绑定会创建独立会话。权限范围不可在该会话中切换；更换授权需要撤销旧绑定。</p>
        <details open className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm">创建或管理项目授权</summary><CopilotManagementPanel onGrantCreated={setGrantId} startConversationLabel="选择此授权" onStartConversation={async id=>setGrantId(id)} /></details>
        {grants.isPending && <p role="status">正在加载授权…</p>}
        {!grants.isPending && !validGrants.length && <p className="text-sm">尚无可用授权，请先创建。</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">私聊身份<select aria-label="私聊身份" className="w-full rounded-md border border-border bg-background p-2" value={identity?.id??''} onChange={e=>setIdentityId(e.target.value)}><option value="">选择已确认身份</option>{identities.map(i=><option key={i.id} value={i.id}>{i.externalUserId}</option>)}</select></label>
          <label className="space-y-1 text-sm">授权<select aria-label="授权" className="w-full rounded-md border border-border bg-background p-2" value={grant?.id??''} onChange={e=>setGrantId(e.target.value)}><option value="">选择有效授权</option>{validGrants.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        </div>
        {grant && <div className="space-y-1 rounded-md border border-border/70 p-3 text-sm"><p>项目：{grant.scope.projectIds.map(id=>projects.data?.projects.find(p=>p.id===id)?.name??id).join('、')||'无现有项目'}</p><p className="break-all">允许操作：{grant.scope.capabilities.join('、')||'无写操作'}</p><p className="break-all">允许目录：{grant.scope.allowedRoots.join('、')||'无额外目录'}</p><p>已用次数：{grant.usedActions}/{grant.maxActions??"不限"} · 最大并发：{grant.maxConcurrency}</p><p>到期：{grant.expiresAt===null?"长期有效，直至撤销":new Date(grant.expiresAt).toLocaleString()}</p></div>}
        <Button disabled={busy||!grant||!identity||data.routes.some(r=>r.identityId===identity.id&&r.status==='active')} onClick={()=>void perform(async()=>{await channels.createChannelRoute(identity!.id,grant!.id);setSuccess("渠道绑定已创建；请以上方实时状态为准，状态正常后发送一条新消息。");})}>启用飞书远程操作</Button>
        {data.routes.map(r=><div key={r.id} className="space-y-2 rounded-md border border-border/70 p-3 text-sm"><p>{grants.data?.grants.find(g=>g.id===r.grantId)?.name??r.grantId} · {routeState(r)}</p><p className="break-all text-xs text-muted-foreground">独立会话：{r.conversationId}</p><Link className="inline-block underline underline-offset-4" href={`/copilot?c=${encodeURIComponent(r.conversationId)}`}>打开会话与审批</Link><Button variant="outline" size="sm" disabled={busy||r.status!=='active'} onClick={()=>void perform(()=>channels.revokeChannelRoute(r.id))}>撤销渠道授权</Button></div>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>最近结果回传</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">“飞书已接收”不代表已读。“结果不确定”可能已经送达，请先核对飞书；系统不会自动重发。</p>
        {!data.deliveries.length && <p>暂无回传记录。</p>}
        {data.deliveries.map(d=><div key={d.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-border/70 p-3"><span>{d.phase==='terminal'?'任务结果':'审批提示'} · {label(d.status)}</span><time>{new Date(d.createdAt).toLocaleString()}</time></div>)}
      </CardContent></Card>
    </>}
  </div>;
}
