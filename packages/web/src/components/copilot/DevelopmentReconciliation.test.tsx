// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DevelopmentTasks } from './DevelopmentTasks';
import { LanguageProvider } from '@/hooks/use-language';
import { setToken } from '@/lib/auth';
import type { DevelopmentTask } from '@/lib/development-api';

let client: QueryClient;
afterEach(()=>{cleanup();client?.clear();vi.unstubAllGlobals();localStorage.clear();});
const unknownTask:DevelopmentTask={id:'t1',projectId:'p1',goal:'检查任务',status:'indeterminate',revision:3,recipeDigest:'recipe',sourceDigest:'source',outputDigest:null,artifactDigest:null,error:null,createdAt:1,updatedAt:1};
function response(data:unknown){return new Response(JSON.stringify({code:0,data,message:''}));}
function fixture(reconcile:(request:RequestInit)=>Promise<Response>){
 let task={...unknownTask};
 const fetcher=vi.fn(async(url:string,request:RequestInit)=>{
  const path=new URL(url).pathname;
  if(path==='/api/v1/projects')return response({projects:[{id:'p1',name:'项目一'}]});
  if(path.endsWith('/capability'))return response({available:false,reason:'DEVELOPMENT_SANDBOX_REQUIRES_MACOS'});
  if(path.endsWith('/tasks'))return response({tasks:[task]});
  if(path.endsWith('/tasks/t1'))return response({task,evidence:null});
  if(path.endsWith('/reconcile'))return reconcile(request);
  throw new Error(`Unexpected external request: ${path}`);
 });
 vi.stubGlobal('fetch',fetcher);
 setToken('test-only-token');
 client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 render(<LanguageProvider><QueryClientProvider client={client}><DevelopmentTasks initialProjectId="p1" initialTaskId="t1"/></QueryClientProvider></LanguageProvider>);
 return {fetcher,setTask:(next:DevelopmentTask)=>{task=next;}};
}

it('offers authenticated owner reconciliation with exact revision and never executes or requeues',async()=>{
 let resolve!:(response:Response)=>void;
 const reconcile=vi.fn((_request:RequestInit)=>new Promise<Response>(done=>{resolve=done;}));
 const {fetcher,setTask}=fixture(reconcile);
 const button=await screen.findByRole('button',{name:'核实执行状态'});
 fireEvent.click(button);
 fireEvent.click(button);
 await waitFor(()=>expect(reconcile).toHaveBeenCalledOnce());
 const request=reconcile.mock.calls[0]![0] as RequestInit;
 expect(JSON.parse(request.body as string)).toEqual({projectId:'p1',expectedRevision:3});
 expect(request.headers).toMatchObject({Authorization:'Bearer test-only-token'});
 expect((screen.getByRole('button',{name:'正在核实…'}) as HTMLButtonElement).disabled).toBe(true);
 const ended={...unknownTask,status:'failed' as const,revision:4};
 setTask(ended);
 await act(async()=>{resolve(response({task:ended}));});
 await screen.findByText('停止状态已核实，最终任务结果仍未知；不会重新排队。');
 expect(screen.queryByRole('button',{name:'核实执行状态'})).toBeNull();
 expect(fetcher.mock.calls.filter(([,options])=>options.method==='POST')).toHaveLength(1);
});

it('explains a stale reconciliation revision and refreshes facts without resubmitting',async()=>{
 const reconcile=vi.fn(async()=>new Response(JSON.stringify({code:1,message:'cannot reconcile',details:{code:'DEVELOPMENT_RECONCILIATION_STALE'}}),{status:409}));
 const {setTask}=fixture(reconcile);
 const button=await screen.findByRole('button',{name:'核实执行状态'});
 setTask({...unknownTask,revision:4});
 fireEvent.click(button);
 await screen.findByText('任务状态或版本已变化，已刷新回执；请核对最新状态后再核实。');
 await screen.findByText(/版本 4/);
 expect(reconcile).toHaveBeenCalledOnce();
 expect(screen.queryByRole('button',{name:/预览.*操作/})).toBeNull();
});

it('keeps a legacy execution fenced when trustworthy identity is missing',async()=>{
 const reconcile=vi.fn(async()=>new Response(JSON.stringify({code:1,message:'cannot reconcile',details:{code:'DEVELOPMENT_RECONCILIATION_IDENTITY_MISSING'}}),{status:409}));
 fixture(reconcile);
 fireEvent.click(await screen.findByRole('button',{name:'核实执行状态'}));
 await screen.findByText('历史执行缺少可靠身份，任务继续保持隔离。请联系管理员核实主机恢复记录。');
 expect(reconcile).toHaveBeenCalledOnce();
 expect(screen.queryByRole('button',{name:/预览.*操作/})).toBeNull();
});
