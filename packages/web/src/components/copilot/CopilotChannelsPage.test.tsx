// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CopilotChannelsPage } from './CopilotChannelsPage';
import { LanguageProvider } from '@/hooks/use-language';
import * as api from '@/lib/api';
import * as channels from '@/lib/copilot-channels-api';
import * as platform from '@/lib/platform-actions-api';
import * as notificationApi from '@/lib/feishu-notifications-api';
import * as telegramNotificationApi from '@/lib/telegram-notifications-api';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/lib/api',()=>({getFeishuChannelAccount:vi.fn(),getFeishuConnectionHealth:vi.fn(),saveFeishuChannelAccount:vi.fn(),emergencyStopFeishu:vi.fn(),getTelegramChannelAccount:vi.fn(),getTelegramConnectionHealth:vi.fn(),saveTelegramChannelAccount:vi.fn(),getTelegramIntegrationConfig:vi.fn(),getFeishuIntegrationConfig:vi.fn(),updateFeishuIntegrationConfig:vi.fn(),updateTelegramIntegrationConfig:vi.fn(),emergencyStopTelegram:vi.fn(),getChannelDiagnostics:vi.fn()}));
vi.mock('@/lib/copilot-channels-api',()=>({getChannelRecords:vi.fn(),createChannelPairing:vi.fn(),confirmChannelPairing:vi.fn(),cancelChannelPairing:vi.fn(),revokeChannelIdentity:vi.fn(),createChannelRoute:vi.fn(),revokeChannelRoute:vi.fn()}));
vi.mock('@/lib/platform-actions-api',()=>({getProjectOverview:vi.fn()}));
vi.mock('@/lib/telegram-notifications-api',()=>({getTelegramNotificationSettings:vi.fn(),getTelegramNotificationDeliveries:vi.fn(),saveTelegramNotificationSettings:vi.fn(),testTelegramNotification:vi.fn()}));
vi.mock('@/lib/feishu-notifications-api',()=>({getFeishuNotificationSettings:vi.fn(async()=>({config:{enabled:false,targetId:null,identityId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0},ready:false,blocker:'TARGET_INVALID',targets:[]})),getFeishuNotificationDeliveries:vi.fn(async()=>({deliveries:[]})),saveFeishuNotificationSettings:vi.fn(),testFeishuNotification:vi.fn()}));
const account={id:'a',appId:'cli_test',enabled:true,secretConfigured:true,configRevision:1,connectionState:'connected',updatedAt:''};
const pairing={id:'pair',accountId:'a',accountRevision:1,status:'claimed',revision:2,externalUserId:'ou_owner',chatId:'oc_owner',expiresAt:Date.now()+600000};
const identity={id:'i',accountId:'a',accountRevision:1,externalUserId:'ou_owner',chatId:'oc_owner',status:'active'};
const project={id:'p',name:'测试项目',management:{projectId:'p',mode:'manual' as const,ownerLabel:'',nextAction:'',freshnessHours:24,revision:1,updatedAt:null},counts:{total:0,todo:0,in_progress:0,blocked:0,ready_for_review:0,done:0,cancelled:0},goal:null,autonomy:'manual_only' as const,evidenceFreshness:{status:'unknown' as const,fresh:0,stale:0,unknown:0,lastObservedAt:null}};
const route={id:'r',identityId:'i',projectId:'p',conversationId:'c',status:'active',authorityValid:true};
let client:QueryClient;
beforeEach(()=>{vi.resetAllMocks();client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 Element.prototype.hasPointerCapture=vi.fn(()=>false);
 Element.prototype.releasePointerCapture=vi.fn();
 Element.prototype.scrollIntoView=vi.fn();
 vi.mocked(notificationApi.getFeishuNotificationSettings).mockResolvedValue({config:{enabled:false,targetId:null,identityId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0},ready:false,blocker:'TARGET_INVALID',targets:[]});
 vi.mocked(notificationApi.getFeishuNotificationDeliveries).mockResolvedValue({deliveries:[]});
 vi.mocked(telegramNotificationApi.getTelegramNotificationSettings).mockResolvedValue({config:{enabled:false,targetId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0},ready:false,blocker:'TARGET_INVALID',targets:[]});
 vi.mocked(telegramNotificationApi.getTelegramNotificationDeliveries).mockResolvedValue({deliveries:[]});
 vi.mocked(api.getFeishuChannelAccount).mockResolvedValue(account);vi.mocked(api.getFeishuConnectionHealth).mockResolvedValue({state:'connected',accountId:'a',configRevision:1,reconnectAttempt:0,lastConnectedAt:null,lastErrorMessage:null});
 vi.mocked(api.getTelegramChannelAccount).mockResolvedValue(null);vi.mocked(api.getTelegramConnectionHealth).mockResolvedValue({state:'disabled',accountId:null,configRevision:null,reconnectAttempt:0,lastConnectedAt:null,lastErrorMessage:null});
 vi.mocked(api.getFeishuIntegrationConfig).mockResolvedValue({enabled:true,emergencyDisabled:false,allowedChatIds:[],identityMode:'user',commandPrefix:'/fb'});
 vi.mocked(api.getTelegramIntegrationConfig).mockResolvedValue({enabled:true,emergencyDisabled:false,allowedChatIds:[]});vi.mocked(api.updateTelegramIntegrationConfig).mockImplementation(async(input)=>({enabled:true,emergencyDisabled:false,allowedChatIds:input.allowedChatIds??[]}));vi.mocked(api.getChannelDiagnostics).mockResolvedValue({channel:'feishu',generatedAt:0,checks:[]});
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pairing],identities:[identity],routes:[],deliveries:[]});
 vi.mocked(platform.getProjectOverview).mockResolvedValue({projects:[project],observedAt:Date.now()});
});
afterEach(()=>{cleanup();client.clear();});
async function mount(){render(<LanguageProvider><QueryClientProvider client={client}><CopilotChannelsPage /></QueryClientProvider></LanguageProvider>);await screen.findByRole('heading',{name:'私聊身份'});}
async function confirmRevoke(){
 fireEvent.click(screen.getByRole('button',{name:'撤销绑定'}));
 const dialog=await screen.findByRole('dialog');
 fireEvent.click(within(dialog).getByRole('button',{name:'撤销绑定'}));
}
it('requires exact claim acknowledgement and clears it when revision changes',async()=>{
 await mount();const confirm=screen.getByRole('button',{name:'确认身份'});expect(confirm).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('checkbox',{name:'我确认这是自己的飞书私聊'}));expect(confirm).toHaveProperty('disabled',false);
 client.setQueryData(['copilot-channels'],(data:Record<string,unknown>)=>({...data,pairings:[{...pairing,revision:3,externalUserId:'ou_changed'}]}));
 await waitFor(()=>expect(confirm).toHaveProperty('disabled',true));fireEvent.click(screen.getByRole('checkbox',{name:'我确认这是自己的飞书私聊'}));fireEvent.click(confirm);
 await waitFor(()=>expect(channels.confirmChannelPairing).toHaveBeenCalledWith(expect.objectContaining({revision:3,externalUserId:'ou_changed',chatId:'oc_owner'})));
 expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('clears write-only secret on failed submission without caching or rendering it',async()=>{
 vi.mocked(api.saveFeishuChannelAccount).mockRejectedValue(new Error('test-only-secret'));
 await mount();fireEvent.click(screen.getByRole('button',{name:'修改配置'}));const secret=screen.getByLabelText('App Secret');fireEvent.change(secret,{target:{value:'test-only-secret'}});fireEvent.click(screen.getByRole('button',{name:'保存并启用'}));
 await screen.findByRole('alert');expect(secret).toHaveProperty('value','');expect(screen.queryByText('test-only-secret')).toBeNull();
 expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('test-only-secret');expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('creates a Copilot channel conversation without project authorization',async()=>{
 await mount();expect(screen.getByText(/飞书尚未连接/)).toBeTruthy();const bind=screen.getByRole('button',{name:'连接飞书'});expect(bind).toHaveProperty('disabled',false);
 expect(screen.queryByRole('combobox',{name:'项目'})).toBeNull();
 fireEvent.click(bind);await waitFor(()=>expect(channels.createChannelRoute).toHaveBeenCalledWith('i'));
});
it('keeps uncertain delivery in a disclosure and confirms route revocation',async()=>{
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[identity],routes:[route],deliveries:[{id:'d',accountId:'a',channel:'feishu',inboxId:'m',phase:'terminal',status:'unknown',createdAt:Date.now(),receiptRecorded:false}]});
 await mount();
 fireEvent.click(screen.getByRole('button',{name:'展开回传记录'}));
 expect(screen.getByText('任务结果')).not.toBeNull();expect(screen.getByText('结果不确定')).not.toBeNull();expect(screen.getByRole('link',{name:'打开会话'}).getAttribute('href')).toBe('/copilot?c=c');expect(screen.queryByRole('button',{name:/重发/})).toBeNull();
 expect(screen.getByText('p')).not.toBeNull();expect(screen.getAllByText('已连接').length).toBeGreaterThan(0);
 await confirmRevoke();await waitFor(()=>expect(channels.revokeChannelRoute).toHaveBeenCalledWith('r'));
});
it('keeps pairing tokens out of query cache and clears them on claim',async()=>{
 const pending={...pairing,status:'pending',revision:1,externalUserId:null,chatId:null};
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pending],identities:[],routes:[],deliveries:[]});vi.mocked(channels.createChannelPairing).mockResolvedValue({pairing:pending,token:'one-time-test-token'});
 await mount();fireEvent.click(screen.getByRole('button',{name:'生成配对码'}));await screen.findByText('/pair one-time-test-token');
 expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('one-time-test-token');
 client.setQueryData(['copilot-channels'],(data:Record<string,unknown>)=>({...data,pairings:[pairing]}));
 await waitFor(()=>expect(screen.queryByText('/pair one-time-test-token')).toBeNull());
});
it('handles an unconfigured account without loading a separate project list',async()=>{
 vi.mocked(api.getFeishuChannelAccount).mockResolvedValue(null);
 await mount();expect(screen.getByRole('button',{name:'生成配对码'})).toHaveProperty('disabled',true);expect(platform.getProjectOverview).not.toHaveBeenCalled();
});
it('treats an unselected project as normal Copilot conversation state',async()=>{
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[identity],routes:[{...route,projectId:null}],deliveries:[]});
 await mount();
 expect(screen.getByText('尚未选择项目')).not.toBeNull();
 expect(screen.queryByText('项目不存在')).toBeNull();
 expect(screen.queryByText(/授权/)).toBeNull();
 expect(screen.getByRole('link',{name:'打开会话'}).getAttribute('href')).toBe('/copilot?c=c');
 expect(screen.getByRole('button',{name:'撤销绑定'})).toHaveProperty('disabled',false);
});
it('hides revoked routes and identities from channel settings',async()=>{
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[{...identity,status:'revoked'}],routes:[{...route,status:'revoked',authorityValid:false}],deliveries:[]});
 await mount();
 expect(screen.queryByRole('link',{name:'打开会话'})).toBeNull();
 expect(screen.queryByRole('button',{name:'撤销绑定'})).toBeNull();
 expect(screen.queryByText(/ou_owner · 已撤销/)).toBeNull();
});
it('clears a submitted secret after success and clears a token on cancellation',async()=>{
 const pending={...pairing,status:'pending',revision:1,externalUserId:null,chatId:null};
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pending],identities:[],routes:[],deliveries:[]});
 vi.mocked(channels.createChannelPairing).mockResolvedValue({pairing:pending,token:'cancel-test-token'});vi.mocked(api.saveFeishuChannelAccount).mockResolvedValue(account);
 await mount();fireEvent.click(screen.getByRole('button',{name:'修改配置'}));fireEvent.change(screen.getByLabelText('App Secret'),{target:{value:'test-only-secret'}});fireEvent.click(screen.getByRole('button',{name:'保存并启用'}));
 await waitFor(()=>expect(api.saveFeishuChannelAccount).toHaveBeenCalled());
 await waitFor(()=>expect(screen.queryByLabelText('App Secret')).toBeNull());
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成配对码'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'生成配对码'}));await screen.findByText('/pair cancel-test-token');
 fireEvent.click(screen.getByRole('button',{name:'取消配对'}));await waitFor(()=>expect(screen.queryByText('/pair cancel-test-token')).toBeNull());expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('shows a read-only credential summary for a configured account and expands on demand',async()=>{
 await mount();
 expect(screen.getByText('App ID')).toBeTruthy();
 expect(screen.getByText(/cli_test/)).toBeTruthy();
 expect(screen.queryByLabelText('App Secret')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'修改配置'}));
 expect(screen.getByLabelText('App Secret')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('App Secret'),{target:{value:'draft-secret'}});
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(screen.queryByLabelText('App Secret')).toBeNull();
 expect(screen.getByText(/cli_test/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'修改配置'}));
 expect(screen.getByLabelText('App Secret')).toHaveProperty('value','');
});
it('shows the connection form directly when no credentials are saved',async()=>{
 vi.mocked(api.getFeishuChannelAccount).mockResolvedValue(null);
 await mount();
 expect(screen.getByLabelText('App Secret')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'修改配置'})).toBeNull();
});
it('keeps the chat allowlist read-only until edit is requested',async()=>{
 vi.mocked(api.getFeishuIntegrationConfig).mockResolvedValue({enabled:true,emergencyDisabled:false,allowedChatIds:['oc_1','oc_2'],identityMode:'user',commandPrefix:'/fb'});
 await mount();
 expect(screen.getByText('oc_1, oc_2')).toBeTruthy();
 expect(screen.queryByLabelText('群聊白名单')).toBeNull();
 fireEvent.click(screen.getByText('聊天白名单',{exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'编辑白名单'}));
 expect(screen.getByLabelText('群聊白名单')).toHaveProperty('value','oc_1, oc_2');
 fireEvent.change(screen.getByLabelText('群聊白名单'),{target:{value:'oc_3'}});
 fireEvent.click(screen.getByRole('button',{name:'取消'}));
 expect(screen.queryByLabelText('群聊白名单')).toBeNull();
 expect(screen.getByText('oc_1, oc_2')).toBeTruthy();
});
it('removes an expired pairing token',async()=>{
 const pending={...pairing,status:'pending',revision:1,externalUserId:null,chatId:null};
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pending],identities:[],routes:[],deliveries:[]});
 vi.mocked(channels.createChannelPairing).mockImplementation(async()=>({pairing:{...pending,expiresAt:Date.now()+1000},token:'expiry-test-token'}));
 vi.mocked(platform.getProjectOverview).mockResolvedValue({projects:[project],observedAt:Date.now()});
 await mount();expect(screen.getByRole('button',{name:'连接飞书'})).toHaveProperty('disabled',true);fireEvent.click(screen.getByRole('button',{name:'生成配对码'}));await screen.findByText('/pair expiry-test-token');
 await waitFor(()=>expect(screen.queryByText('/pair expiry-test-token')).toBeNull(),{timeout:3000});
});
it('keeps identities, routes and deliveries scoped to the selected channel account', async()=>{
 vi.mocked(api.getTelegramChannelAccount).mockResolvedValue({id:'tg',botUsername:'testbot',enabled:true,secretConfigured:true,configRevision:7,connectionState:'connected',updatedAt:'',lastConnectedAt:null,lastErrorCode:null,lastErrorMessage:null});
 const tgIdentity={...identity,id:'ti',accountId:'tg',externalUserId:'tg-owner',accountRevision:7};
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[identity,tgIdentity],routes:[route,{...route,id:'tr',identityId:'ti',conversationId:'tc'}],deliveries:[]});
 await mount();expect(screen.queryByText('tg-owner')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Telegram'}));
 await screen.findByText('tg-owner');
 expect(screen.queryByText('ou_owner')).toBeNull();
 expect(await screen.findByText('Telegram 通知')).toBeTruthy();expect(screen.queryByText('飞书通知')).toBeNull();
 expect(screen.getAllByRole('link',{name:'打开会话'})).toHaveLength(1);
 expect(screen.getByRole('link',{name:'打开会话'}).getAttribute('href')).toBe('/copilot?c=tc');
 await confirmRevoke();
 await waitFor(()=>expect(channels.revokeChannelRoute).toHaveBeenCalledWith('tr'));
});
it('does not let an unavailable Telegram endpoint break the Feishu page',async()=>{
 vi.mocked(api.getTelegramChannelAccount).mockRejectedValue(new Error('unavailable'));
 await mount();fireEvent.click(screen.getByRole('button',{name:'修改配置'}));
 expect(screen.getByLabelText('App Secret')).toBeTruthy();
 expect(api.getTelegramChannelAccount).not.toHaveBeenCalled();expect(screen.queryByText('加载失败。')).toBeNull();
});
it('does not silently truncate the Feishu chat allowlist',async()=>{
 await mount();fireEvent.click(screen.getByText('聊天白名单',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'设置白名单'}));
 fireEvent.change(screen.getByLabelText('群聊白名单'),{target:{value:Array.from({length:51},(_,i)=>`oc_${i}`).join(',')}});
 expect(screen.getByRole('button',{name:'保存白名单'})).toHaveProperty('disabled',true);
 expect(screen.getByText('最多允许 50 个聊天 ID，请减少后再保存。')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('群聊白名单'),{target:{value:'oc_1,oc_1,oc_2'}});
 fireEvent.click(screen.getByRole('button',{name:'保存白名单'}));
 await waitFor(()=>expect(api.updateFeishuIntegrationConfig).toHaveBeenCalledWith({allowedChatIds:['oc_1','oc_2']}));
 await waitFor(()=>expect(screen.queryByLabelText('群聊白名单')).toBeNull());
});
it('labels missing evidence and in-flight delivery without a success checkmark',async()=>{
 vi.mocked(api.getChannelDiagnostics).mockResolvedValue({channel:'feishu',generatedAt:0,checks:[{key:'model',ok:false,status:'untested',detail:'模型尚未测试',fixHint:''},{key:'delivery',ok:false,status:'pending',detail:'回传等待中',fixHint:''}]});
 await mount();fireEvent.click(screen.getByRole('button',{name:'展开诊断'}));expect(await screen.findByText('模型尚未测试')).toBeTruthy();expect(screen.getByText('未验证')).toBeTruthy();expect(screen.getByText('回传等待中')).toBeTruthy();expect(screen.getByText('进行中')).toBeTruthy();
});
it('can switch to Telegram even when the default Feishu account request fails',async()=>{
 vi.mocked(api.getFeishuChannelAccount).mockRejectedValue(new Error('Feishu unavailable'));
 render(<QueryClientProvider client={client}><LanguageProvider><CopilotChannelsPage/></LanguageProvider></QueryClientProvider>);
 await screen.findByText('加载失败。');
 fireEvent.click(screen.getByRole('button',{name:'Telegram'}));
 await screen.findByLabelText('Bot Token');
 expect(screen.queryByText('加载失败。')).toBeNull();
});
it('explains stale identity next to disabled activation', async()=>{
 vi.mocked(api.getFeishuChannelAccount).mockResolvedValue({...account,configRevision:3});
 await mount();
 expect(screen.getByRole('button',{name:'连接飞书'})).toHaveProperty('disabled',true);
 expect(screen.getByText('需重新配对')).toBeTruthy();
 expect(screen.getByTestId('channel-activation-reason').textContent).toContain('身份已失效，请重新配对并确认身份');
 expect(screen.getAllByRole('link',{name:'前往身份配对'}).length).toBeGreaterThan(0);
});
it('disables new connections while emergency stopped, retaining revocation and cancellation', async()=>{
 vi.mocked(api.getFeishuIntegrationConfig).mockResolvedValue({enabled:true,emergencyDisabled:true,allowedChatIds:[],identityMode:'bot',commandPrefix:'/fb'});
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pairing],identities:[identity],routes:[route],deliveries:[]});
 await mount();
 fireEvent.click(screen.getByRole('checkbox',{name:'我确认这是自己的飞书私聊'}));
 expect(screen.getByRole('button',{name:'生成配对码'})).toHaveProperty('disabled',true);
 expect(screen.getByRole('button',{name:'确认身份'})).toHaveProperty('disabled',true);
 expect(screen.queryByRole('button',{name:'连接飞书'})).toBeNull();
 expect(screen.getByRole('button',{name:'撤销绑定'})).toHaveProperty('disabled',false);
 expect(screen.getByRole('button',{name:'取消配对'})).toHaveProperty('disabled',false);
});
it('does not report a deleted parent as connected or show project authorization', async()=>{
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[identity],routes:[{...route,authorityValid:false}],deliveries:[]});
 await mount();
 expect(screen.queryByText(/飞书已连接 Copilot/)).toBeNull();
 expect(screen.getAllByText('p').length).toBeGreaterThan(0);expect(screen.getByText('连接已失效')).toBeTruthy();
 expect(screen.queryByTestId('channel-activation-reason')).toBeNull();
 expect(screen.getByRole('button',{name:'撤销绑定'})).toHaveProperty('disabled',false);
});
it('does not infer a connection from a legacy route lacking server authority status', async()=>{
 const {authorityValid:_,...legacyRoute}=route;
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[identity],routes:[legacyRoute],deliveries:[]});
 await mount();expect(screen.queryByText(/飞书已连接 Copilot/)).toBeNull();
 expect(screen.getByText('p')).not.toBeNull();expect(screen.getByText('状态待核查')).not.toBeNull();
});
it('enables conversation creation as soon as identity is current without helper copy', async()=>{
 await mount();expect(screen.queryByTestId('channel-activation-reason')).toBeNull();
 expect(screen.getByRole('button',{name:'连接飞书'})).toHaveProperty('disabled',false);
});
it('does not offer a new connection when integration configuration failed to load', async()=>{
 vi.mocked(api.getFeishuIntegrationConfig).mockRejectedValue(new Error('unavailable'));
 await mount();
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成配对码'})).toHaveProperty('disabled',true));
 expect(screen.getByRole('button',{name:'连接飞书'})).toHaveProperty('disabled',true);
 expect(screen.getByTestId('channel-activation-reason').textContent).toContain('渠道配置加载失败');
});
it('renders the channels setup in English instead of hardcoded Chinese', async()=>{
 window.localStorage.setItem('forgebadger-language', 'en');
 try {
  render(<LanguageProvider><QueryClientProvider client={client}><CopilotChannelsPage /></QueryClientProvider></LanguageProvider>);
  await screen.findByRole('heading',{name:'Private-chat identity'});
  expect(screen.getByText('App ID')).toBeTruthy();
  expect(screen.getByRole('button', {name:'Connect Feishu'})).toBeTruthy();
  expect(screen.getByRole('checkbox', {name:'I confirm this is my own Feishu private chat'})).toBeTruthy();
  expect(screen.queryByTestId('channel-activation-reason')).toBeNull();
  expect(screen.getByText(/Feishu is not connected/)).toBeTruthy();
  expect(screen.queryByText('生成配对码')).toBeNull();
  expect(screen.queryByText('凭证已保存')).toBeNull();
  expect(screen.getByRole('heading', {name:'Operations & diagnostics'})).toBeTruthy();
 } finally {
  window.localStorage.removeItem('forgebadger-language');
 }
});
it('renders the operations & diagnostics sub-header and skips aggressive polling when unconfigured', async()=>{
 vi.useFakeTimers();
 try {
  vi.mocked(api.getFeishuChannelAccount).mockResolvedValue(null);
  render(<LanguageProvider><QueryClientProvider client={client}><CopilotChannelsPage /></QueryClientProvider></LanguageProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole('heading',{name:'运维与诊断'})).toBeTruthy();
  const initialCalls = vi.mocked(channels.getChannelRecords).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
  expect(vi.mocked(channels.getChannelRecords).mock.calls.length).toBe(initialCalls);
 } finally {
  vi.useRealTimers();
 }
});
