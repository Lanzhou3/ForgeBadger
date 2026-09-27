// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeishuNotificationSettings } from './FeishuNotificationSettings';
import * as api from '@/lib/feishu-notifications-api';
import { GatewayApiError } from '@/lib/api';
vi.mock('@/lib/feishu-notifications-api',()=>({getFeishuNotificationSettings:vi.fn(),saveFeishuNotificationSettings:vi.fn(),getFeishuNotificationDeliveries:vi.fn(),testFeishuNotification:vi.fn(),refreshFeishuNotificationTargets:vi.fn()}));
const target:api.FeishuNotificationTarget={id:'private:i',kind:'private',name:'我的私聊',accountId:'a',accountRevision:1,chatId:'oc_owner',revision:1,available:true,reason:null};
const initial:api.FeishuNotificationState={config:{enabled:false,targetId:null,identityId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0},ready:false,blocker:'TARGET_INVALID',targets:[target]};
let client:QueryClient;
beforeEach(()=>{
  vi.resetAllMocks();client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  // jsdom implements neither Pointer Capture nor scrollIntoView; Radix Select calls both.
  Element.prototype.hasPointerCapture=vi.fn(()=>false);
  Element.prototype.releasePointerCapture=vi.fn();
  Element.prototype.scrollIntoView=vi.fn();
  vi.mocked(api.getFeishuNotificationSettings).mockResolvedValue(structuredClone(initial));
  vi.mocked(api.getFeishuNotificationDeliveries).mockResolvedValue({deliveries:[]});
  vi.mocked(api.saveFeishuNotificationSettings).mockImplementation(async config=>({config:{...config,revision:config.revision+1},ready:true,blocker:null,targets:[target]}));
  vi.mocked(api.testFeishuNotification).mockResolvedValue({id:'test',status:'pending'});
});
afterEach(()=>{cleanup();client.clear();});
async function mount(available=true) {
  render(<QueryClientProvider client={client}><FeishuNotificationSettings available={available}/></QueryClientProvider>);
  await screen.findByRole('switch',{name:'接收 ForgeBadger 通知'});
}
function toggle(){return screen.getByRole('switch',{name:'接收 ForgeBadger 通知'});}
function expectChecked(state:'true'|'false'){expect(toggle().getAttribute('aria-checked')).toBe(state);}
async function selectTarget(name:string){
  const trigger=screen.getByRole('combobox',{name:'通知接收位置'});
  fireEvent.keyDown(trigger,{key:'Enter'});
  const option=await screen.findByRole('option',{name});
  fireEvent.pointerDown(option,{button:0});fireEvent.pointerUp(option,{button:0});fireEvent.click(option);
}
it('enables personal notifications without any project or remote route',async()=>{
  await mount();const toggle=screen.getByRole('switch',{name:'接收 ForgeBadger 通知'});
  expect(toggle.getAttribute('aria-checked')).toBe('false');expect(toggle).toHaveProperty('disabled',false);
  fireEvent.click(toggle);fireEvent.click(screen.getByRole('checkbox',{name:'应用操作结果'}));
  fireEvent.change(screen.getByLabelText('ForgeBadger Web 地址'),{target:{value:'https://forge.example.com'}});
  fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));
  await waitFor(()=>expect(api.saveFeishuNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({enabled:true,identityId:'i',types:['attention','failure','completion','app_action'],webBaseUrl:'https://forge.example.com',revision:0})));
  await screen.findByText(/只推送之后产生/);
});
it('does not offer an enabled switch before pairing, and keeps disabling available for stale identities',async()=>{
  vi.mocked(api.getFeishuNotificationSettings).mockResolvedValue({...initial,targets:[]});await mount(false);expect(toggle()).toHaveProperty('disabled',true);
  client.setQueryData(['feishu-notification-settings'],{...initial,config:{...initial.config,enabled:true,targetId:'private:revoked',identityId:'revoked',revision:4}});
  await waitFor(()=>expect(toggle()).toHaveProperty('disabled',false));
  fireEvent.click(toggle());fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));
  await waitFor(()=>expect(api.saveFeishuNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({enabled:false,revision:4})));
});
it('requires saved enabled settings before testing and reports enqueue rather than delivery',async()=>{
  await mount();expect(screen.getByRole('button',{name:'发送测试卡片'})).toHaveProperty('disabled',true);
  fireEvent.click(toggle());
  expect(screen.getByRole('button',{name:'发送测试卡片'})).toHaveProperty('disabled',true);
  fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'发送测试卡片'})).toHaveProperty('disabled',false));
  fireEvent.click(screen.getByRole('button',{name:'发送测试卡片'}));
  await screen.findByText(/测试卡片已入队/);expect(api.testFeishuNotification).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('测试卡片已送达')).toBeNull();
});
it('prevents enabling with no types and surfaces conflict/error without losing edits',async()=>{
  await mount();fireEvent.click(toggle());
  for(const name of ['需要处理 / 等待审批','任务失败 / 权限被拒绝','任务完成'])fireEvent.click(screen.getByRole('checkbox',{name}));
  expect(screen.getByRole('button',{name:'保存通知设置'})).toHaveProperty('disabled',true);
  fireEvent.click(screen.getByRole('checkbox',{name:'任务完成'}));
  vi.mocked(api.saveFeishuNotificationSettings).mockRejectedValue(new Error('conflict'));
  fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));await screen.findByText(/保存失败/);
  expectChecked('true');
});
it('shows unavailable configuration and distinct uncertain delivery status',async()=>{
  vi.mocked(api.getFeishuNotificationSettings).mockResolvedValue({...initial,config:{...initial.config,enabled:true},blocker:'TARGET_UNAVAILABLE'});
  vi.mocked(api.getFeishuNotificationDeliveries).mockResolvedValue({deliveries:[{id:'d',type:'test',status:'unknown',errorCode:'SEND_UNCERTAIN',createdAt:Date.now()}]});
  await mount();await screen.findByText(/接收位置已不可用/);await screen.findByText('测试卡片 · 结果不确定');
  expect(screen.getByRole('button',{name:'发送测试卡片'})).toHaveProperty('disabled',true);
});

it.each([
  ['CONFIG_CONFLICT', /配置已在其他页面更新/],
  ['ACCOUNT_CHANGED', /账号配置已变化，请重新配对身份/],
  ['WEB_URL_INVALID', /Web 地址格式不正确/],
])('explains %s with the relevant recovery action', async (code, message) => {
  vi.mocked(api.saveFeishuNotificationSettings).mockRejectedValue(new GatewayApiError('通知配置未保存', 409, { code }));
  await mount();
  fireEvent.click(screen.getByRole('button', { name: '保存通知设置' }));
  await screen.findByText(message);
});

it('requires explicit selection of a group and explains who receives its notifications', async () => {
  const group:api.FeishuNotificationTarget={...target,id:'group:g',kind:'group',name:'开发群',chatId:'oc_group'};
  vi.mocked(api.getFeishuNotificationSettings).mockResolvedValue({...initial,targets:[group]});
  await mount();
  expect(screen.getByRole('combobox',{name:'通知接收位置'}).textContent).toContain('选择私聊或群聊');
  fireEvent.click(toggle());
  expect(screen.getByRole('button',{name:'保存通知设置'})).toHaveProperty('disabled',true);
  await selectTarget('群聊 · 开发群');
  expect(screen.getByRole('note').textContent).toContain('群成员均可查看');
  fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));
  await waitFor(()=>expect(api.saveFeishuNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({enabled:true,targetId:'group:g',identityId:null})));
});

it('retains the selected target and edits when refreshing the group directory fails', async () => {
  await mount();
  fireEvent.click(toggle());
  fireEvent.change(screen.getByLabelText('ForgeBadger Web 地址'),{target:{value:'https://example.com'}});
  vi.mocked(api.refreshFeishuNotificationTargets).mockRejectedValue(new GatewayApiError('failed',409,{code:'DIRECTORY_PERMISSION_REQUIRED'}));
  fireEvent.click(screen.getByRole('button',{name:'刷新接收位置'}));
  await screen.findByText(/飞书应用缺少读取群聊列表或群成员状态的权限/);
  expect(screen.getByRole('combobox',{name:'通知接收位置'}).textContent).toContain('私聊 · 我的私聊');
  expect(screen.getByLabelText('ForgeBadger Web 地址')).toHaveProperty('value','https://example.com');
});

it('shows the permission failure reason from a queued test delivery', async () => {
  vi.mocked(api.getFeishuNotificationDeliveries).mockResolvedValue({deliveries:[{id:'test',type:'test',status:'failed',errorCode:'DIRECTORY_PERMISSION_REQUIRED',createdAt:Date.now()}]});
  await mount();
  await screen.findByText('测试卡片 · 发送失败');
  await screen.findByText(/飞书应用缺少读取群聊列表或群成员状态的权限/);
});
