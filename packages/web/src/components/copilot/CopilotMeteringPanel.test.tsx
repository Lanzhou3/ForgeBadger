// @vitest-environment jsdom
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import { CopilotMeteringPanel } from './CopilotMeteringPanel';
import { LanguageProvider } from '@/hooks/use-language';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('shows unknown costs, saves zero as free and allows revoking a later run',async()=>{
 let runId='run1';const requests:Array<{url:string;method:string;body:string}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  requests.push({url,method:options?.method??'GET',body:String(options?.body??'')});
  const data=url.includes('model-providers')?{models:[{id:'model',isDefault:true}],providers:[]}:
   url.endsWith('/runs')?{runs:[{id:runId}]}:url.endsWith('/usage')?{usage:{reportedTokens:120,estimatedCalls:1,costUsd:null,knownCostUsd:0.01,unpricedCalls:1}}:
   url.includes('token-rates')?{rates:{inputUsdPerMillion:1,outputUsdPerMillion:2}}:{revoked:true};
  return Response.json({code:0,data,message:''});
 }));
 const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 render(<LanguageProvider><QueryClientProvider client={cache}><CopilotMeteringPanel conversationId="conversation" modelId="model"/></QueryClientProvider></LanguageProvider>);
 const summary=screen.getByText('用量、计价与修复控制');const details=summary.closest('details')!;
 details.open=true;fireEvent(details,new Event('toggle'));
 await screen.findByText(/未知（已知部分/);
 await waitFor(()=>expect((screen.getByLabelText('输入费率') as HTMLInputElement).value).toBe('1'));
 fireEvent.change(screen.getByLabelText('输入费率'),{target:{value:'0'}});
 fireEvent.submit(screen.getByRole('button',{name:'保存费率'}).closest('form')!);
 await screen.findByText('费率已保存。');
 expect(JSON.parse(requests.find(r=>r.method==='PUT')!.body).inputUsdPerMillion).toBe(0);
 fireEvent.click(screen.getByRole('button',{name:'停止本次执行的后续修复'}));await screen.findByText('已停止后续修复');
 runId='run2';await cache.invalidateQueries({queryKey:['copilot','meter-runs','conversation']});
 await waitFor(()=>expect(screen.getByRole('button',{name:'停止本次执行的后续修复'}).hasAttribute('disabled')).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'停止本次执行的后续修复'}));
 await waitFor(()=>expect(requests.some(r=>r.method==='DELETE'&&r.url.endsWith('/runs/run2/repairs'))).toBe(true));
 cache.clear();
});
it('reports network errors without presenting zero-cost success',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('offline');}));
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<LanguageProvider><QueryClientProvider client={cache}><CopilotMeteringPanel conversationId="conversation" modelId="model"/></QueryClientProvider></LanguageProvider>);
 const details=screen.getByText('用量、计价与修复控制').closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));
 await screen.findByRole('alert');expect(screen.queryByText('费率已保存。')).toBeNull();cache.clear();
});
