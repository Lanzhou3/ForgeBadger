// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CopilotChannelsPage } from './CopilotChannelsPage';
import { LanguageProvider } from '@/hooks/use-language';
import * as api from '@/lib/api';
import * as channels from '@/lib/copilot-channels-api';
import * as platform from '@/lib/platform-actions-api';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/lib/api',()=>({getFeishuChannelAccount:vi.fn(),getFeishuConnectionHealth:vi.fn(),saveFeishuChannelAccount:vi.fn(),emergencyStopFeishu:vi.fn(),getTelegramChannelAccount:vi.fn(),getTelegramConnectionHealth:vi.fn(),saveTelegramChannelAccount:vi.fn(),getTelegramIntegrationConfig:vi.fn(),updateTelegramIntegrationConfig:vi.fn(),emergencyStopTelegram:vi.fn(),getChannelDiagnostics:vi.fn()}));
vi.mock('@/lib/copilot-channels-api',()=>({getChannelRecords:vi.fn(),createChannelPairing:vi.fn(),confirmChannelPairing:vi.fn(),cancelChannelPairing:vi.fn(),revokeChannelIdentity:vi.fn(),createChannelRoute:vi.fn(),revokeChannelRoute:vi.fn()}));
vi.mock('@/lib/platform-actions-api',()=>({getProjectOverview:vi.fn(),setCopilotAutonomy:vi.fn()}));
vi.mock('./CopilotManagementPanel',()=>({CopilotManagementPanel:()=> <div>项目自治管理</div>}));
const account={id:'a',appId:'cli_test',enabled:true,secretConfigured:true,configRevision:1,connectionState:'connected',updatedAt:''};
const pairing={id:'pair',accountId:'a',accountRevision:1,status:'claimed',revision:2,externalUserId:'ou_owner',chatId:'oc_owner',expiresAt:Date.now()+600000};
const identity={id:'i',accountId:'a',accountRevision:1,externalUserId:'ou_owner',chatId:'oc_owner',status:'active'};
const project={id:'p',name:'测试项目',copilotAutonomy:true,management:{projectId:'p',mode:'manual' as const,ownerLabel:'',nextAction:'',freshnessHours:24,revision:1,updatedAt:null},counts:{total:0,todo:0,in_progress:0,blocked:0,ready_for_review:0,done:0,cancelled:0},goal:null,autonomy:'manual_only' as const,evidenceFreshness:{status:'unknown' as const,fresh:0,stale:0,unknown:0,lastObservedAt:null}};
const route={id:'r',identityId:'i',projectId:'p',conversationId:'c',status:'active'};
let client:QueryClient;
beforeEach(()=>{vi.resetAllMocks();client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 vi.mocked(api.getFeishuChannelAccount).mockResolvedValue(account);vi.mocked(api.getFeishuConnectionHealth).mockResolvedValue({state:'connected',accountId:'a',configRevision:1,reconnectAttempt:0,lastConnectedAt:null,lastErrorMessage:null});
 vi.mocked(api.getTelegramChannelAccount).mockResolvedValue(null);vi.mocked(api.getTelegramConnectionHealth).mockResolvedValue({state:'disabled',accountId:null,configRevision:null,reconnectAttempt:0,lastConnectedAt:null,lastErrorMessage:null});
 vi.mocked(api.getTelegramIntegrationConfig).mockResolvedValue({enabled:true,emergencyDisabled:false,allowedChatIds:[]});vi.mocked(api.updateTelegramIntegrationConfig).mockImplementation(async(input)=>({enabled:true,emergencyDisabled:false,allowedChatIds:input.allowedChatIds??[]}));vi.mocked(api.getChannelDiagnostics).mockResolvedValue({channel:'feishu',generatedAt:0,checks:[]});
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pairing],identities:[identity],routes:[],deliveries:[]});
 vi.mocked(platform.getProjectOverview).mockResolvedValue({projects:[project],observedAt:Date.now()});
});
afterEach(()=>{cleanup();client.clear();});
async function mount(){render(<LanguageProvider><QueryClientProvider client={client}><CopilotChannelsPage /></QueryClientProvider></LanguageProvider>);await screen.findByText('2. 确认私聊身份');}
it('requires exact claim acknowledgement and clears it when revision changes',async()=>{
 await mount();const confirm=screen.getByRole('button',{name:'确认身份'});expect(confirm).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('checkbox'));expect(confirm).toHaveProperty('disabled',false);
 client.setQueryData(['copilot-channels'],(data:Record<string,unknown>)=>({...data,pairings:[{...pairing,revision:3,externalUserId:'ou_changed'}]}));
 await waitFor(()=>expect(confirm).toHaveProperty('disabled',true));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(confirm);
 await waitFor(()=>expect(channels.confirmChannelPairing).toHaveBeenCalledWith(expect.objectContaining({revision:3,externalUserId:'ou_changed',chatId:'oc_owner'})));
 expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('clears write-only secret on failed submission without caching or rendering it',async()=>{
 vi.mocked(api.saveFeishuChannelAccount).mockRejectedValue(new Error('test-only-secret'));
 await mount();const secret=screen.getByLabelText('App Secret');fireEvent.change(secret,{target:{value:'test-only-secret'}});fireEvent.click(screen.getByRole('button',{name:'保存并启用'}));
 await screen.findByRole('alert');expect(secret).toHaveProperty('value','');expect(screen.queryByText('test-only-secret')).toBeNull();
 expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('test-only-secret');expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('binds the selected autonomy project and identity',async()=>{
 await mount();expect(screen.getByText(/飞书远程操作尚未启用/)).toBeTruthy();const bind=screen.getByRole('button',{name:'启用飞书远程操作'});expect(bind).toHaveProperty('disabled',true);
 fireEvent.change(screen.getByLabelText('私聊身份'),{target:{value:'i'}});fireEvent.change(screen.getByLabelText('项目'),{target:{value:'p'}});
 fireEvent.click(bind);await waitFor(()=>expect(channels.createChannelRoute).toHaveBeenCalledWith('i','p'));
});
it('displays unknown delivery honestly without a resend action and can revoke a route',async()=>{
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[identity],routes:[route],deliveries:[{id:'d',inboxId:'m',phase:'terminal',status:'unknown',createdAt:Date.now(),receiptRecorded:false}]});
 await mount();expect(screen.getByText('任务结果 · 结果不确定')).not.toBeNull();expect(screen.getByRole('link',{name:'打开会话'}).getAttribute('href')).toBe('/copilot?c=c');expect(screen.queryByRole('button',{name:/重发/})).toBeNull();
 expect(screen.getByText('测试项目 · 权限有效')).not.toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'撤销渠道绑定'}));await waitFor(()=>expect(channels.revokeChannelRoute).toHaveBeenCalledWith('r'));
});
it('keeps pairing tokens out of query cache and clears them on claim',async()=>{
 const pending={...pairing,status:'pending',revision:1,externalUserId:null,chatId:null};
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pending],identities:[],routes:[],deliveries:[]});vi.mocked(channels.createChannelPairing).mockResolvedValue({pairing:pending,token:'one-time-test-token'});
 await mount();fireEvent.click(screen.getByRole('button',{name:'生成新的配对码'}));await screen.findByText('/pair one-time-test-token');
 expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.state.data))).not.toContain('one-time-test-token');
 client.setQueryData(['copilot-channels'],(data:Record<string,unknown>)=>({...data,pairings:[pairing]}));
 await waitFor(()=>expect(screen.queryByText('/pair one-time-test-token')).toBeNull());
});
it('handles an unconfigured account and projects without autonomy',async()=>{
 vi.mocked(api.getFeishuChannelAccount).mockResolvedValue(null);vi.mocked(platform.getProjectOverview).mockResolvedValue({projects:[],observedAt:Date.now()});
 await mount();expect(screen.getByRole('button',{name:'生成新的配对码'})).toHaveProperty('disabled',true);expect(screen.getByText('尚无已开启 Copilot 自治的项目，请先在上方打开项目开关。')).not.toBeNull();
});

it('shows routes honestly when project autonomy is off while retaining revoke',async()=>{
 vi.mocked(platform.getProjectOverview).mockResolvedValue({projects:[{...project,copilotAutonomy:false}],observedAt:Date.now()});
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[],identities:[identity],routes:[route],deliveries:[]});
 await mount();expect(screen.getByText('测试项目 · 项目 Copilot 自治未开启')).not.toBeNull();expect(screen.getByRole('button',{name:'撤销渠道绑定'})).toHaveProperty('disabled',false);
});
it('clears a submitted secret after success and clears a token on cancellation',async()=>{
 const pending={...pairing,status:'pending',revision:1,externalUserId:null,chatId:null};
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pending],identities:[],routes:[],deliveries:[]});
 vi.mocked(channels.createChannelPairing).mockResolvedValue({pairing:pending,token:'cancel-test-token'});vi.mocked(api.saveFeishuChannelAccount).mockResolvedValue(account);
 await mount();fireEvent.change(screen.getByLabelText('App Secret'),{target:{value:'test-only-secret'}});fireEvent.click(screen.getByRole('button',{name:'保存并启用'}));
 await waitFor(()=>expect(api.saveFeishuChannelAccount).toHaveBeenCalled());expect(screen.getByLabelText('App Secret')).toHaveProperty('value','');
 await waitFor(()=>expect(screen.getByRole('button',{name:'生成新的配对码'})).toHaveProperty('disabled',false));fireEvent.click(screen.getByRole('button',{name:'生成新的配对码'}));await screen.findByText('/pair cancel-test-token');
 fireEvent.click(screen.getByRole('button',{name:'取消本次配对'}));await waitFor(()=>expect(screen.queryByText('/pair cancel-test-token')).toBeNull());expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it('removes an expired pairing token',async()=>{
 const pending={...pairing,status:'pending',revision:1,externalUserId:null,chatId:null};
 vi.mocked(channels.getChannelRecords).mockResolvedValue({pairings:[pending],identities:[],routes:[],deliveries:[]});
 vi.mocked(channels.createChannelPairing).mockImplementation(async()=>({pairing:{...pending,expiresAt:Date.now()+1000},token:'expiry-test-token'}));
 vi.mocked(platform.getProjectOverview).mockResolvedValue({projects:[{...project,copilotAutonomy:false}],observedAt:Date.now()});
 await mount();expect(screen.queryByRole('option',{name:'测试项目'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'生成新的配对码'}));await screen.findByText('/pair expiry-test-token');
 await waitFor(()=>expect(screen.queryByText('/pair expiry-test-token')).toBeNull(),{timeout:3000});
});
