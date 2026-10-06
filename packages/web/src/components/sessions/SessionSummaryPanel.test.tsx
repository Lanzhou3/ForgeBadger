// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {LanguageProvider} from '@/hooks/use-language';
import {getSessionSummary,type CliSessionSummary} from '@/lib/session-summary-api';
import {SessionSummaryPanel} from './SessionSummaryPanel';
vi.mock('@/lib/session-summary-api',()=>({getSessionSummary:vi.fn()}));
let client:QueryClient;
beforeEach(()=>{localStorage.setItem('forgebadger-language','zh-CN');client=new QueryClient({defaultOptions:{queries:{retry:false}}});vi.resetAllMocks();});
afterEach(()=>{cleanup();client.clear();});
const summary:CliSessionSummary={version:1,runtimeEpoch:'runtime',identityQuality:'exact_turn',state:'working',observedAt:Date.now(),request:'当前 B 请求',progress:[],verification:[]};
function mount(){return render(<QueryClientProvider client={client}><LanguageProvider><SessionSummaryPanel sessionId="session"/></LanguageProvider></QueryClientProvider>);}
it('keeps the current request separate from a late historical result and shows its source',async()=>{
  vi.mocked(getSessionSummary).mockResolvedValue({workState:'working',summary,latestResult:{...summary,request:'历史 A 请求',state:'task_completed',result:{text:'历史 A 结果',source:'native_final_message'}}});
  mount();await screen.findByText('当前请求：当前 B 请求');
  expect(screen.queryByText('当前请求：历史 A 请求')).toBeNull();
  expect(screen.getByText('历史 A 结果')).toBeTruthy();expect(screen.getByText('来源：CLI 最终回复')).toBeTruthy();
  expect(screen.getByText('未采集到命令验证证据。')).toBeTruthy();
});
it('does not call an unknown runtime failed or completed and keeps recorded results visible',async()=>{
  vi.mocked(getSessionSummary).mockResolvedValue({workState:'unknown',summary:null,latestResult:{...summary,result:{text:'Recorded result',source:'native_final_message'}}});
  mount();await screen.findByText(/当前进度未知/);expect(screen.getByText('Recorded result')).toBeTruthy();
});
it('explains missing observations and shows read failures',async()=>{
  vi.mocked(getSessionSummary).mockResolvedValue({workState:'unknown',summary:null,latestResult:null});
  const view=mount();await screen.findByText(/尚未采集到观察记录/);view.unmount();client.clear();
  vi.mocked(getSessionSummary).mockRejectedValue(new Error('offline'));mount();await screen.findByRole('alert');
});
