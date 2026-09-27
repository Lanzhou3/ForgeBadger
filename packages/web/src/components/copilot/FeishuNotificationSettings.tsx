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

interface Props {available:boolean}
const key=['feishu-notification-settings'];
const deliveryKey=['feishu-notification-deliveries'];
const choices:{type:FeishuNotificationType;label:string}[]=[{type:'attention',label:'需要处理 / 等待审批'},
  {type:'failure',label:'任务失败 / 权限被拒绝'},{type:'completion',label:'任务完成'},
  {type:'lifecycle',label:'任务中断 / 会话结束'},{type:'app_action',label:'应用操作结果'},{type:'automation',label:'自动化任务结果'}];
const blockers:Record<string,string>={IDENTITY_INVALID:'请先完成私聊身份确认。',ACCOUNT_CHANGED:'账号配置已变化，请重新配对身份。',
  CHANNEL_DISABLED:'请先启用飞书应用，或解除紧急停止。',USER_DISABLED:'当前账号已停用。',
  TARGET_INVALID:'请选择一个已确认的私聊或已核验的群聊。',TARGET_UNAVAILABLE:'接收位置已不可用，请刷新列表并重新选择。',
  TARGET_CHANGED:'接收位置已变化，请重新选择并保存。',TARGET_CONFLICT:'接收位置与旧版私聊设置冲突，请刷新页面后重新选择。'};
const statuses:Record<string,string>={pending:'待发送',sending:'发送中',delivered:'飞书已接收',failed:'发送失败',unknown:'结果不确定',cancelled:'已取消'};
const errorMessages:Record<string,string>={...blockers,
  CONFIG_CONFLICT:'配置已在其他页面更新，请重新加载通知设置后再修改。',
  WEB_URL_INVALID:'Web 地址格式不正确，请使用完整的 http:// 或 https:// 地址，不包含账号密码、查询参数或 # 片段；也可以留空。',
  TYPES_REQUIRED:'请至少选择一种通知类型。',INPUT_INVALID:'提交的通知设置格式不正确，请检查输入。',
  SUBSCRIPTION_DISABLED:'请先开启并保存通知设置。',QUEUE_FULL:'待发送通知已达上限，请等待队列处理后再测试。',
  INTERNAL_ERROR:'服务端暂时无法处理通知请求，请稍后重试。',
  DIRECTORY_PERMISSION_REQUIRED:'飞书应用缺少读取群聊列表或群成员状态的权限，请在飞书开放平台补齐权限后刷新。',
  DIRECTORY_UNAVAILABLE:'暂时无法核验飞书群聊，请检查应用权限及网络后刷新；已保存的设置不会被清空。',
  DIRECTORY_INCOMPLETE:'群聊列表未能完整读取，请稍后刷新。',
};
export function FeishuNotificationSettings({available}:Props) {
  const client=useQueryClient();
  const query=useQuery({queryKey:key,queryFn:getFeishuNotificationSettings,refetchInterval:5000,refetchIntervalInBackground:false});
  const deliveries=useQuery({queryKey:deliveryKey,queryFn:getFeishuNotificationDeliveries,refetchInterval:5000,refetchIntervalInBackground:false});
  const [draft,setDraft]=useState<FeishuNotificationConfig|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [errorCode,setErrorCode]=useState('');
  const reportError=(cause:unknown,action:string)=>{
    const code=cause instanceof GatewayApiError&&typeof cause.details?.code==='string'?cause.details.code:'';
    setErrorCode(code);
    const message=errorMessages[code]??(cause instanceof GatewayApiError&&cause.status===401
      ?'登录已失效，请重新登录。':'暂时无法完成请求，请检查 Gateway 连接后重试。');
    setError(`${action}失败。${message}`);
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
      ?'接收位置已刷新。':'未发现可用的已配置群聊，请确认机器人已加入该群。已确认私聊仍可直接选择。');}
    catch(cause){reportError(cause,'刷新接收位置');}
    finally{setBusy(false);}
  };
  const save=async()=>{
    if(!config)return;setBusy(true);setError('');setErrorCode('');setNotice('');
    try{const saved=await saveFeishuNotificationSettings(withTarget(config));client.setQueryData(key,saved);setDraft(null);
      setNotice(saved.config.enabled?'飞书通知已开启，只推送之后产生的通知。':'飞书通知已关闭，尚未发送的通知已取消。');await client.invalidateQueries({queryKey:deliveryKey});}
    catch(cause){reportError(cause,'保存');}
    finally{setBusy(false);}
  };
  const test=async()=>{
    setBusy(true);setError('');setErrorCode('');setNotice('');
    try{await testFeishuNotification(crypto.randomUUID());setNotice('测试卡片已入队，请查看下方投递状态和所选会话。');await client.invalidateQueries({queryKey:deliveryKey});}
    catch(cause){reportError(cause,'测试通知入队');}
    finally{setBusy(false);}
  };
  return <Card id="feishu-notifications" className="forgebadger-animate-in">
    <SettingsCardHeader
      icon={<Bell className="size-4" />}
      title="飞书通知"
      description="选择已确认的私聊或已核验的群聊接收通知卡片。保存仅授权通知推送，不改变远程命令白名单或项目操作权限。"
      action={config&&(
        <Switch
          aria-label="接收 ForgeBadger 通知"
          checked={config.enabled}
          disabled={busy||query.isError||(!config.enabled&&(!available||!targets.some(target=>target.available)))}
          onCheckedChange={(checked)=>patch({enabled:checked})}
        />
      )}
    />
    <CardContent className="space-y-3">
      {query.isPending && <p role="status">正在加载通知设置…</p>}
      {query.isError && <p role="alert">通知设置加载失败。</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(errorCode==='CONFIG_CONFLICT'||query.isError) && <Button variant="outline" disabled={busy} onClick={()=>{setDraft(null);setError('');setErrorCode('');void query.refetch();}}>重新加载通知设置</Button>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {config && <>
        <div className="space-y-1 text-sm">
          <span>通知接收位置</span>
          <Select
            value={selected}
            disabled={busy||query.isError}
            onValueChange={(value)=>patch({targetId:value||null})}
          >
            <SelectTrigger aria-label="通知接收位置" className="w-full min-w-0">
              <SelectValue placeholder="选择私聊或群聊" />
            </SelectTrigger>
            <SelectContent>
              {selected&&!selectedTarget&&<SelectItem value={selected}>已失效的接收位置，请重新选择</SelectItem>}
              {targets.map(target=><SelectItem key={target.id} value={target.id} disabled={!target.available}>{target.kind==='group'?'群聊':'私聊'} · {target.name}{target.available?'':' · 不可用'}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" disabled={busy||!available} onClick={()=>void refresh()}>刷新接收位置</Button>
        <p className="text-xs text-muted-foreground">私聊来自已确认身份；刷新会核验已配置或已使用的群聊。机器人需在群内，并具备读取群列表与群成员状态的权限。</p>
        {selectedTarget?.kind==='group'&&<p role="note" className="break-words text-sm">所选通知将发送到群“{selectedTarget.name}”，群成员均可查看。</p>}
        <fieldset disabled={busy||query.isError} className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 text-sm">通知类型</legend>
          {choices.map(choice=><label key={choice.type} className="flex items-center gap-2 text-sm"><Checkbox aria-label={choice.label} checked={config.types.includes(choice.type)}
            onCheckedChange={(checked)=>patch({types:checked===true?[...config.types,choice.type]:config.types.filter(t=>t!==choice.type)})}/>{choice.label}</label>)}
        </fieldset>
        <label className="block space-y-1 text-sm">ForgeBadger Web 地址（可选）<Input aria-label="ForgeBadger Web 地址" value={config.webBaseUrl} placeholder="https://forge.example.com" disabled={busy||query.isError} onChange={e=>patch({webBaseUrl:e.target.value})}/></label>
        <p className="text-xs text-muted-foreground">填写飞书所在设备能访问的地址，卡片才显示查看按钮；localhost 只指向当前设备。留空仍可接收卡片摘要。卡片不提供直接审批操作。</p>
        {!draft&&query.data?.blocker&&<p className="text-sm text-muted-foreground">{blockers[query.data.blocker]??'请检查通知配置。'}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy||query.isError||(config.enabled&&(!selectedTarget?.available||!config.types.length))} onClick={()=>void save()}>保存通知设置</Button>
          <Button variant="outline" disabled={busy||!!draft||query.isError||!query.data?.config.enabled||!query.data.ready} onClick={()=>void test()}>发送测试卡片</Button></div>
      </>}
      <div className="space-y-2 border-t border-border/70 pt-3 text-sm"><p>最近通知投递</p>
        <p className="text-xs text-muted-foreground">飞书已接收不代表已读；结果不确定时请先核对接收会话，系统不会自动重发。</p>
        {deliveries.isPending&&<p>正在加载投递记录…</p>}{deliveries.isError&&<p role="alert">投递记录加载失败。</p>}
        {deliveries.data?.deliveries.length===0&&<p className="text-muted-foreground">暂无通知投递记录。</p>}
        {deliveries.data?.deliveries.map(item=><div key={item.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-border/70 p-2">
          <span>{item.type==='test'?'测试卡片':choices.find(c=>c.type===item.type)?.label??'通知'} · {statuses[item.status]??item.status}</span><time>{new Date(item.createdAt).toLocaleString()}</time>
          {item.errorCode&&errorMessages[item.errorCode]&&<p className="w-full text-xs text-muted-foreground">{errorMessages[item.errorCode]}</p>}
        </div>)}
      </div>
    </CardContent>
  </Card>;
}
