import assert from 'node:assert/strict';
import { it } from 'node:test';
import { hasNoProgress } from '../src/services/agent/no-progress.js';
import type { RunStep } from '../src/services/agent/run-ledger.js';

function read(path:string, output:unknown={content:'stable',nextOffset:null}, input?:string):RunStep {
  return {id:path,user_id:'u',run_id:'run',ordinal:0,kind:'tool',status:'completed',tool_name:'read_project_file',
    tool_call_id:path,input_json:input??JSON.stringify({path,projectId:'p'}),input_digest:null,result_json:JSON.stringify(output),effect:'read',attempt:1,fence:1};
}
function check(steps:RunStep[]):boolean {
  return hasNoProgress(steps.flatMap(step=>[{...step,kind:'model' as const},step]));
}
it('does not treat duplicate reads from one parallel model batch as repeated rounds',()=>{
  const a=read('a');
  assert.equal(hasNoProgress([{...a,kind:'model'},a,a,a]),false);
});
it('detects three repeated two-file rounds, but preserves changing observations',()=>{
  const rounds=Array.from({length:6},(_,i)=>read(i%2?'b':'a'));
  assert.equal(check(rounds),true);
  rounds[5]=read('b',{content:'new evidence'});assert.equal(check(rounds),false);
});
it('canonicalizes object keys but preserves array order and all values',()=>{
  const a=read('a',{},'{"path":"a","filters":[1,2]}'),b=read('a',{},'{"filters":[1,2],"path":"a"}');
  assert.equal(check([a,b,a]),true);
  assert.equal(check([a,read('a',{},'{"filters":[2,1],"path":"a"}'),a]),false);
});
for(const output of [{truncated:true,preview:'same'},{content:'same',nextOffset:10},{redacted:true,content:'same'}, {ok:false,error:'same'}, {nested:{contextTruncated:true}}])
  it(`does not stop from incomplete or failed evidence ${JSON.stringify(output)}`,()=>assert.equal(check([read('a',output),read('a',output),read('a',output)]),false));
it('writes, polling tools, unfinished reads and errors break the observation sequence',()=>{
  const a=read('a');
  for(const barrier of [ {...a,effect:'write' as const}, {...a,tool_name:'get_development_task'},
    {...a,status:'running' as const}, {...a,result_json:'Tool error: unavailable'}]) {
    assert.equal(check([a,barrier,a,a]),false);
  }
  assert.equal(check([a,a]),false);
});
it('excludes search snippets even when pagination says the search is complete',()=>{
  const search={...read('a',{matches:[],nextOffset:null,nextLineOffset:0,truncated:false}),tool_name:'search_project_files'};
  assert.equal(check([search,search,search]),false);
});
