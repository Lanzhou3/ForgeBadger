// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/hooks/use-language';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TelegramNotificationSettings } from './TelegramNotificationSettings';
import * as api from '@/lib/telegram-notifications-api';
import * as feishu from '@/lib/feishu-notifications-api';
import { GatewayApiError } from '@/lib/api';
vi.mock('@/lib/telegram-notifications-api',()=>({getTelegramNotificationSettings:vi.fn(),saveTelegramNotificationSettings:vi.fn(),getTelegramNotificationDeliveries:vi.fn(),testTelegramNotification:vi.fn()}));
vi.mock('@/lib/feishu-notifications-api',()=>({getFeishuNotificationSettings:vi.fn(),saveFeishuNotificationSettings:vi.fn(),getFeishuNotificationDeliveries:vi.fn(),testFeishuNotification:vi.fn(),refreshFeishuNotificationTargets:vi.fn()}));
const target:api.TelegramNotificationTarget={id:'private:t',kind:'private',name:'已确认私聊 · 4242',accountId:'tg',accountRevision:1,chatId:'4242',revision:1,available:true,reason:null};
const initial:api.TelegramNotificationState={config:{enabled:false,targetId:null,types:['attention','failure','completion'],webBaseUrl:'',revision:0},ready:false,blocker:'TARGET_INVALID',targets:[target]};
let client:QueryClient;
beforeEach(()=>{
  vi.resetAllMocks();client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  Element.prototype.hasPointerCapture=vi.fn(()=>false);
  Element.prototype.releasePointerCapture=vi.fn();
  Element.prototype.scrollIntoView=vi.fn();
  vi.mocked(api.getTelegramNotificationSettings).mockResolvedValue(structuredClone(initial));
  vi.mocked(api.getTelegramNotificationDeliveries).mockResolvedValue({deliveries:[]});
  vi.mocked(api.saveTelegramNotificationSettings).mockImplementation(async config=>({config:{...config,revision:config.revision+1},ready:true,blocker:null,targets:[target]}));
  vi.mocked(api.testTelegramNotification).mockResolvedValue({id:'test',status:'pending'});
});
afterEach(()=>{cleanup();client.clear();});
async function mount(available=true) {
  render(<LanguageProvider><QueryClientProvider client={client}><TelegramNotificationSettings available={available}/></QueryClientProvider></LanguageProvider>);
  await screen.findByRole('switch',{name:'接收 ForgeBadger 通知'});
}
it('enables private-chat notifications and sends exactly the strict subscription fields',async()=>{
  await mount();
  expect(screen.getByText('Telegram 通知')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'刷新接收位置'})).toBeNull();
  fireEvent.click(screen.getByRole('switch',{name:'接收 ForgeBadger 通知'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'应用操作结果'}));
  fireEvent.change(screen.getByLabelText('ForgeBadger Web 地址'),{target:{value:'https://forge.example.com'}});
  fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));
  await waitFor(()=>expect(api.saveTelegramNotificationSettings).toHaveBeenCalledWith({enabled:true,targetId:'private:t',
    types:['attention','failure','completion','app_action'],webBaseUrl:'https://forge.example.com',revision:0}));
  await screen.findByText(/Telegram 通知已开启/);
  expect(feishu.saveFeishuNotificationSettings).not.toHaveBeenCalled();
});
it('queues a test message and shows Telegram-specific delivery states',async()=>{
  vi.mocked(api.getTelegramNotificationSettings).mockResolvedValue({...initial,config:{...initial.config,enabled:true,targetId:'private:t',revision:2},ready:true,blocker:null});
  vi.mocked(api.getTelegramNotificationDeliveries).mockResolvedValue({deliveries:[{id:'d',type:'test',status:'delivered',errorCode:null,createdAt:0}]});
  await mount();
  expect(await screen.findByText(/测试消息 · Telegram 已接收/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'发送测试消息'}));
  await waitFor(()=>expect(api.testTelegramNotification).toHaveBeenCalledTimes(1));
  await screen.findByText(/测试消息已入队/);
});
it('explains Telegram blockers and server rejections in channel terms',async()=>{
  vi.mocked(api.getTelegramNotificationSettings).mockResolvedValue({...initial,blocker:'CHANNEL_DISABLED'});
  vi.mocked(api.saveTelegramNotificationSettings).mockRejectedValue(new GatewayApiError('通知配置未保存',409,{code:'TARGET_INVALID'}));
  await mount();
  expect(screen.getByText('请先启用 Telegram 机器人，或解除紧急停止。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'保存通知设置'}));
  await screen.findByText(/请选择一个已确认的 Telegram 私聊/);
});
