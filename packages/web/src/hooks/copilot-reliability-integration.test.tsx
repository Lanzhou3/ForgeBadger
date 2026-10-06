// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/hooks/use-language';
import { useCopilotRun } from './use-copilot';
import { useCopilotFollowups } from './use-copilot-followups';
import { CopilotApproval } from '@/components/copilot/CopilotApproval';
import { FORGEBADGER_GATEWAY_EVENT } from '@/lib/gateway-events';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
function envelope(data: unknown, status=200) { return new Response(JSON.stringify({code:0,data,message:''}),{status}); }
function wrapper({children}:{children:ReactNode}) { return <LanguageProvider>{children}</LanguageProvider>; }

it('composes the actual HTTP client and run hook to recover a gap and avoid per-chunk requests', async () => {
  const run={id:'r1',conversationId:'c1',status:'running',revision:1};
  let snapshot: {steps:Array<{stepId:string;fence:number;sequence:number;text:string}>}|undefined;
  const fetcher=vi.fn(async (_url:string, request:RequestInit) => request.method === 'POST'
    ? envelope({runId:'r1'}) : envelope({run,pendingActions:[],provisionalText:snapshot}));
  vi.stubGlobal('fetch',fetcher);
  const {result}=renderHook(()=>useCopilotRun(),{wrapper});
  await act(async()=>{await result.current.startRun('c1','hello');});
  fetcher.mockClear();
  const frame=(sequence:number,text:string)=>window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT,{detail:{type:'copilot_run_updated',payload:{run_id:'r1',status:'running',revision:1,text_step_id:'s1',text_fence:1,text_sequence:sequence,text_delta:text}}}));
  act(()=>frame(1,'one '));
  expect(fetcher).not.toHaveBeenCalled();
  snapshot={steps:[{stepId:'s1',fence:1,sequence:2,text:'one two '}]};
  await act(async()=>{frame(3,'three ');});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.current.active?.text).toBe('one two three ');
  act(()=>{for(let sequence=4;sequence<=103;sequence++)frame(sequence,'a');});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.current.active?.text).toBe('one two three '+'a'.repeat(100));
});

it('preserves all follow-up request options through the actual API after a lost response', async () => {
  const bodies:unknown[]=[];
  vi.stubGlobal('fetch',vi.fn(async (url:string, request:RequestInit) => {
    if(request.method!=='POST')return envelope({followups:[]});
    bodies.push(JSON.parse(request.body as string));
    if(bodies.length===1)throw new Error('external response lost');
    return envelope({followup:{id:'q1',status:'queued',runId:null}});
  }));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const queryWrapper=({children}:{children:ReactNode})=><LanguageProvider><QueryClientProvider client={client}>{children}</QueryClientProvider></LanguageProvider>;
  const {result,rerender}=renderHook(({modelId,reviewTaskResults,repairFailedChecks})=>useCopilotFollowups({conversationId:'c1',projectId:'p1',modelId,reviewTaskResults,repairFailedChecks,active:false}),{wrapper:queryWrapper,initialProps:{modelId:'m1',reviewTaskResults:true,repairFailedChecks:true}});
  await act(async()=>{expect(await result.current.enqueue('continue')).toBe(false);});
  rerender({modelId:'m2',reviewTaskResults:false,repairFailedChecks:false});
  await act(async()=>{expect(await result.current.enqueue('continue')).toBe(true);});
  expect(bodies[0]).toMatchObject({content:'continue',projectId:'p1',modelId:'m1',reviewTaskResults:true,repairFailedChecks:true,clientRequestId:expect.any(String)});
  expect(bodies[1]).toEqual(bodies[0]);
  client.clear();
});

it('renders a stable authority error from the actual HTTP envelope without retrying the approval', async () => {
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:1,message:'operation rejected',details:{code:'COPILOT_APPROVAL_SCOPE'}}),{status:400}));
  vi.stubGlobal('fetch',fetcher);
  const onDecided=vi.fn();
  render(<LanguageProvider><CopilotApproval action={{id:'a1',runId:'r1',userId:'u1',tool:'mcp_write',inputJson:'{}',inputDigest:'digest',status:'pending',createdAt:'',updatedAt:''}} onDecided={onDecided}/></LanguageProvider>);
  fireEvent.click(screen.getByRole('button',{name:'允许本次调用'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('当前权限'));
  expect(onDecided).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});

it('keeps earlier model steps before a partial current-step HTTP snapshot',async()=>{
 const run={id:'r1',conversationId:'c1',status:'running',revision:1};
 let provisionalText:unknown;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,request:RequestInit)=>request.method==='POST'?envelope({runId:'r1'}):envelope({run,pendingActions:[],provisionalText})));
 const {result}=renderHook(()=>useCopilotRun(),{wrapper});
 await act(async()=>{await result.current.startRun('c1','hello');});
 const frame=(step:string,text:string)=>window.dispatchEvent(new CustomEvent(FORGEBADGER_GATEWAY_EVENT,{detail:{type:'copilot_run_updated',payload:{run_id:'r1',status:'running',revision:1,text_step_id:step,text_fence:1,text_sequence:1,text_delta:text}}}));
 act(()=>{frame('s1','Earlier. ');frame('s2','Later. ');});
 provisionalText={steps:[{stepId:'s2',fence:1,sequence:2,text:'Later. continued.'}]};
 await act(async()=>{await result.current.reconcile();});
 expect(result.current.active?.text).toBe('Earlier. Later. continued.');
});

for(const language of ['zh-CN','zh-TW','en'])for(const code of ['COPILOT_TOOL_DISABLED','COPILOT_TOOL_UNAVAILABLE'])it(`gives a direct ${code} remedy via the actual API in ${language}`,async()=>{
 localStorage.setItem('forgebadger-language',language);
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:1,message:'operation rejected',details:{code}}),{status:400}));
 vi.stubGlobal('fetch',fetcher);
 const onDecided=vi.fn();
 render(<LanguageProvider><CopilotApproval action={{id:'a1',runId:'r1',userId:'u1',tool:'mcp_write',inputJson:'{}',inputDigest:'digest',status:'pending',createdAt:'',updatedAt:''}} onDecided={onDecided}/></LanguageProvider>);
 fireEvent.click(screen.getByRole('button',{name:language==='en'?'Allow this call':language==='zh-TW'?'允許本次呼叫':'允许本次调用'}));
 await waitFor(()=>expect(onDecided).toHaveBeenCalledOnce());
 const message=screen.getByRole('alert').textContent;
 expect(message).toMatch(language==='en'?/tool/i:/工具/);
 expect(message).toMatch(code==='COPILOT_TOOL_DISABLED'?(language==='en'?/settings/i:/設定|设置/):(language==='en'?/connection|dependenc/i:/连接|連線|依赖|相依/));
 expect(message).not.toMatch(/unconfirmed|尚未确认|尚未確認/i);
 expect(fetcher).toHaveBeenCalledOnce();
});
