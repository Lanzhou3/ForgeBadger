/** Run through scripts/run-with-root-env.mjs. Reads configured provider metadata;
 * all tasks/state/checks are synthetic and isolated. Never migrates the live DB. */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { ModelProviderRepository } from '../src/db/repositories/model-provider-repository.js';
import { CopilotPreferencesRepository } from '../src/db/repositories/copilot-preferences-repository.js';
import { createAgentLlmClient } from '../src/services/agent/llm-client.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { reportedTokens } from '../src/services/agent/model-metering.js';
import { RunGovernance } from '../src/services/agent/run-governance.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { runSandboxChecks, sandboxCapability } from '../src/services/development/sandbox.js';
import { redactAgentValue } from '../src/services/agent/redaction.js';

const scenarios:Array<{id:string;goal:string;source:string;extraFiles?:Record<string,string>;checks:string}>=[
 {id:'sum',goal:'Implement addition of two finite numbers, including negative numbers and zero.',source:'module.exports=(a,b)=>a-b;',
  checks:"const a=require('node:assert/strict'),f=require('./subject.cjs');for(const [x,y] of [[2,3],[-3,1],[0,0],[1.5,2.25]])a.equal(f(x,y),x+y);"},
 {id:'clamp',goal:'Clamp a finite number to two supplied endpoints, inclusive. Endpoints may be reversed; first normalize their order.',source:'module.exports=(n,a,b)=>Math.min(b,Math.max(a,n));',
  checks:"const a=require('node:assert/strict'),f=require('./subject.cjs');for(const [n,x,y,z] of [[5,0,10,5],[-1,0,10,0],[15,0,10,10],[5,10,0,5],[-2,10,0,0],[20,10,0,10],[3,3,3,3]])a.equal(f(n,x,y),z);"},
 {id:'module-boundary',goal:'Fix both modules: math.cjs exports sum of finite number arrays; subject.cjs exports their arithmetic mean. Empty input returns zero for both. Preserve CommonJS exports and support negative and decimal values.',source:"const {sum}=require('./math.cjs');module.exports=values=>sum(values)/values.length;",extraFiles:{'math.cjs':'exports.sum=values=>values.reduce((a,b)=>a-b,0);'},
  checks:"const a=require('node:assert/strict'),mean=require('./subject.cjs'),{sum}=require('./math.cjs');for(const xs of [[],[0],[2,4],[-3,1],[1.5,2.5]]){const total=xs.reduce((a,b)=>a+b,0);a.equal(sum(xs),total);a.equal(mean(xs),xs.length?total/xs.length:0);}"}
];
const out=resolve(process.argv[2]??'evaluations/latest.json'),masterKey=process.env.FORGEBADGER_MASTER_KEY;
if(!masterKey)throw new Error('Evaluation requires configured Gateway master key');
if(!sandboxCapability().available)throw new Error('Evaluation requires the real isolated development sandbox');
const sourceDb=new Database(process.env.FORGEBADGER_DB_PATH??join(process.env.FORGEBADGER_STATE_DIR??join(homedir(),'.forgebadger'),'forgebadger.db'),{readonly:true});
const temp=mkdtempSync(join(tmpdir(),'fb-live-eval-')),db=new Database(':memory:');
try {
 const owner=sourceDb.prepare("SELECT u.id FROM users u WHERE u.status='active' AND EXISTS(SELECT 1 FROM model_profiles m WHERE m.user_id=u.id AND m.status='active') ORDER BY u.id LIMIT 1").get() as {id:string}|undefined;
 if(!owner)throw new Error('No active configured model owner');
 const sourceRepo=new ModelProviderRepository(sourceDb,owner.id,masterKey);
 const sourceClient=createAgentLlmClient({modelProviderRepository:sourceRepo,preferences:new CopilotPreferencesRepository(sourceDb,owner.id,masterKey)});
 const selected=sourceClient.resolveProvider();
 migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations',import.meta.url).pathname});
 const key=randomBytes(32).toString('hex'),userId=new UserRepository(db).create('evaluation@fixture.invalid','unused').id;
 const repo=new ModelProviderRepository(db,userId,key);
 const provider=repo.createProviderProfile({name:'Evaluation',providerKey:selected.providerKey,baseUrl:selected.baseUrl,apiFormat:selected.apiFormat,
  authType:selected.authType,supportedAdapters:['codex'],defaultHeaders:selected.defaultHeaders,allowPlaintextHttp:selected.allowPlaintextHttp??false,allowPrivateNetworks:selected.allowPrivateNetworks??false});
 repo.createModelProfile({providerProfileId:provider.id,name:'Evaluation',modelId:selected.modelId,isDefault:true,capabilities:['chat'],...(selected.contextWindow==null?{}:{contextWindow:selected.contextWindow})});
 repo.createCredential({providerProfileId:provider.id,label:'ephemeral',plaintextSecret:selected.apiKey});
 const client=createAgentLlmClient({modelProviderRepository:repo,timeoutMs:60000});
 const results:Array<Record<string,unknown>>=[];
 const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const report={schemaVersion:2,createdAt:new Date().toISOString(),revision,dirtyWorktree:true,model:selected.modelId,
  protocol:selected.apiFormat,fixtureHash:createHash('sha256').update(JSON.stringify(scenarios)).digest('hex'),
  limits:{maxModelInvocationsPerArm:6,requestedMaxOutputTokensPerCall:1024,maxDurationMsPerArm:90000,reportedTokenStopThresholdPerArm:40000},
  pricing:'No live invoice/rate configured; monetary cost unknown. Model invocations/time bounded; output limit requested from provider.',
  tokenPolicy:'Stop before another invocation at the reported token threshold or after missing usage. The final response may exceed the threshold; it is not an exact preflight token cap. Transport retries may add HTTP requests.',
  methodology:'Same model, task and limits. Baseline receives source directly; harness reads the same source through native project tools. Independent fixed checks run in macOS sandbox. Three fixtures including a two-file module boundary; no stochastic repeats or product ranking. Version 2 uses six calls per arm and files JSON; not a matched rerun of version 1.',results};
 for(const scenario of scenarios)for(const arm of ['baseline','harness'] as const) {
  const root=join(temp,`${scenario.id}-${arm}`);mkdirSync(root);writeFileSync(join(root,'subject.cjs'),scenario.source);
  const sources={'subject.cjs':scenario.source,...scenario.extraFiles};
  for(const [name,content]of Object.entries(sources))writeFileSync(join(root,name),content);
  const project=new ProjectRepository(db,userId).create({name:scenario.id,path:root,aiTool:'codex'});
  const started=Date.now();let calls=0,tokens=0,unknownUsageCalls=0,text='',firstTextMs:number|null=null,runId:string|undefined;
  const signal=AbortSignal.timeout(90000);
  const bounded={...client,async stream(request:Parameters<typeof client.stream>[0]){
   if(calls>=6||tokens>=40000||unknownUsageCalls>0)throw new Error('EVALUATION_BUDGET_OR_UNKNOWN_USAGE');
   calls++;unknownUsageCalls++;
   const result=await client.stream({...request,signal:AbortSignal.any([signal,...(request.signal?[request.signal]:[])]),maxOutputTokens:1024,
    onEvent:event=>{if(event.type==='text_delta'&&firstTextMs===null)firstTextMs=Date.now()-started;request.onEvent(event);}});
   const measured=reportedTokens(result.usage);
   if(measured!==undefined){tokens+=measured;unknownUsageCalls--;}
   return result;
  },async generateTitle(){return '';},async summarize(){throw new Error('Evaluation does not permit extra model calls');},async proposeMemory(){return [];}};
  try {
   const instruction=`${scenario.goal}\nReturn ONLY a JSON object {"files":{"filename":"complete replacement CommonJS source"}} covering exactly these files: ${Object.keys(sources).join(", ")}. Do not run commands.`;
   if(arm==='baseline')text=(await bounded.stream({messages:[{role:'user',content:instruction+'\nCurrent sources:\n'+JSON.stringify(sources)}],tools:[],onEvent:()=>{}})).message;
   else {
    const ledger=new CopilotRunLedger(db,userId),conversationId=ledger.log.createConversation('Evaluation').id;
    const orchestrator=createCopilotOrchestrator({db,masterKey:key,eventBus:new ForgeBadgerEventBus(),maxSteps:6,llm:bounded,
      toolRegistry:createAgentToolRegistry(createPlatformTools().filter(tool=>['get_project','read_project_file','list_project_files'].includes(tool.name)))});
    runId=ledger.admit({userId,conversationId,projectId:project.id,userText:instruction},6);
    db.prepare('UPDATE copilot_runs SET token_budget=40000,max_duration_ms=90000 WHERE id=?').run(runId);
    await orchestrator.executeRun(userId,runId);
    text=ledger.log.listMessages(conversationId).filter(m=>m.role==='assistant'&&m.kind==='text').at(-1)?.content??'';
    if(ledger.get(runId)?.status!=='completed')throw new Error('Evaluation run did not complete: '+ledger.get(runId)?.status+' / '+ledger.get(runId)?.stop_reason);
   }
   const candidate:unknown=JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
   if(!candidate||typeof candidate!=='object'||!('files'in candidate)||!candidate.files||typeof candidate.files!=='object'||Array.isArray(candidate.files))throw new Error('Invalid candidate JSON');
   const files=candidate.files as Record<string,unknown>;
   if(Object.keys(files).sort().join('\0')!==Object.keys(sources).sort().join('\0'))throw new Error('Candidate files differ from allowed fixture paths');
   for(const name of Object.keys(sources)) {
    const content=files[name];if(typeof content!=='string'||content.length>65536)throw new Error('Invalid source content');
    writeFileSync(join(root,name),content);
   }
   // Hold-out assertions become visible only AFTER inference; the model cannot read them.
   writeFileSync(join(root,'subject.test.cjs'),scenario.checks);
   const check=await runSandboxChecks({workspace:root,checks:['subject.test.cjs'],signal,timeoutMs:5000});
   results.push({fixture:scenario.id,arm,passed:check.exitCode===0,check,calls,reportedTokens:unknownUsageCalls?null:tokens,knownReportedTokens:tokens,unknownUsageCalls,durationMs:Date.now()-started,firstTextMs,response:text,
    ...(runId?{usage:new RunGovernance(db,userId,runId).usage()}:{}),outputHash:createHash('sha256').update(JSON.stringify(files)).digest('hex')});
  }catch(error){results.push({fixture:scenario.id,arm,passed:false,calls,reportedTokens:unknownUsageCalls?null:tokens,knownReportedTokens:tokens,unknownUsageCalls,durationMs:Date.now()-started,firstTextMs,response:text,...(runId?{usage:new RunGovernance(db,userId,runId).usage()}:{}),error:error instanceof Error?error.message:'Evaluation failed'});}
  writeFileSync(out,JSON.stringify(redactAgentValue(report),null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({fixture:scenario.id,arm,passed:results.at(-1)!.passed,calls,durationMs:Date.now()-started}));
 }
}finally{sourceDb.close();db.close();rmSync(temp,{recursive:true,force:true});}
