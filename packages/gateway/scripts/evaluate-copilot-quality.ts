/** Deterministic harness acceptance, NOT live-model task quality or a product ranking. */
import { execFileSync } from 'node:child_process';
import { writeFileSync,readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const root=fileURLToPath(new URL('..',import.meta.url));
const groups=[
  {id:'tool-discovery',files:['copilot-discovery-quality.test.ts','agent-tool-discovery.test.ts']},
  {id:'chinese-memory-and-provenance',files:['copilot-memory-search-quality.test.ts','copilot-memory-search-http.test.ts']},
  {id:'long-context-and-cache-contract',files:['agent-context-compression.test.ts','copilot-context-efficiency.test.ts']},
  {id:'multi-file-recovery-and-progress',files:['copilot-runtime-efficiency.test.ts','copilot-no-progress.test.ts','copilot-provider-overflow.test.ts']},
  {id:'approval-cancel-and-lease',files:['copilot-read-concurrency.test.ts','copilot-risk-approval.test.ts','copilot-run-governance.test.ts']},
];
const suiteHash=createHash('sha256');
for(const group of groups)for(const file of group.files)suiteHash.update(file).update(readFileSync(`${root}/test/${file}`));
const results=groups.map(group=>{
  const started=performance.now();let output='',exitCode=0;
  try {output=execFileSync(process.execPath,['--test','--test-reporter=tap','--import','tsx',...group.files.map(file=>'test/'+file)],
    {cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});}
  catch(error){const failure=error as {stdout?:string;status?:number};output=String(failure.stdout??'');exitCode=failure.status??1;}
  const count=(name:string)=>Number(output.match(new RegExp(`^# ${name} (\\d+)`,'m'))?.[1]??0);
  return {...group,passed:exitCode===0&&count('tests')>0,exitCode,tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped'),
    elapsedMs:performance.now()-started,failures:output.split('\n').filter(line=>/^\s*not ok\b/u.test(line))};
});
const report={version:1,createdAt:new Date().toISOString(),kind:'deterministic-harness-contracts',suiteHash:suiteHash.digest('hex'),
  methodology:'Real SQLite, real built-in tools and isolated source files; external model responses are synthetic. No production database, live provider, live CLI or monetary benchmark.',
  liveModelCalls:0,tokens:null,costUsd:null,results};
const json=JSON.stringify(report,null,2)+'\n';
if(process.argv[2])writeFileSync(process.argv[2],json);else process.stdout.write(json);
console.log(JSON.stringify(results.map(({id,pass,fail,skipped})=>({id,pass,fail,skipped}))));
if(results.some(result=>!result.passed))process.exitCode=1;
