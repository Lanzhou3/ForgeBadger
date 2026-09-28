import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {draftPullRequestInput,GithubDraftClient,type GithubTransport} from '../src/services/collaboration/github-pull-requests.js';
const input=()=>({repository:'team/repo',headBranch:'codex/task-branch',baseBranch:'main',expectedCommit:'a'.repeat(40),verificationId:randomUUID(),title:'Change',body:'Reviewed delivery',token:randomBytes(24).toString('hex')});
const pull=(i:ReturnType<typeof input>)=>({number:1,html_url:'https://github.com/team/repo/pull/1',draft:true,state:'open',head:{ref:i.headBranch,sha:i.expectedCommit,repo:{full_name:i.repository}},base:{ref:i.baseBranch,repo:{full_name:i.repository}}});
test('checks exact remote branches then creates a draft with transient credential and guarded transport',async()=>{
 const i=input(),calls:Array<{url:string;method:string;body:unknown}>=[];let checks=0;
 const io:GithubTransport=async(url,init,authorize)=>{authorize();calls.push({url,method:init.method!,body:init.body?JSON.parse(String(init.body)):null});assert.equal(new Headers(init.headers).get('Authorization'),`Bearer ${i.token}`);return Response.json(url.includes('/git/ref/')?{object:{type:'commit',sha:url.endsWith('/main')?'b'.repeat(40):i.expectedCommit}}:init.method==='POST'?pull(i):[]);};
 const client=new GithubDraftClient(i,()=>{checks++},io);await client.verifyRemote('b'.repeat(40));assert.equal(await client.find(),null);const result=await client.create();
 assert.equal(result.url,pull(i).html_url);assert.ok(checks>=8);assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.equal((calls.at(-1)!.body as {draft:boolean}).draft,true);
 assert.ok(calls.every(x=>x.url.startsWith('https://api.github.com/repos/team/repo/')));assert.ok(!JSON.stringify(result).includes(i.token));
});
test('rejects moved head before mutation and finds an existing matching request without POST',async()=>{
 const i=input();let posts=0;const io:GithubTransport=async(url,init)=>{if(init.method==='POST')posts++;return Response.json(url.includes('/git/ref/')?{object:{type:'commit',sha:'c'.repeat(40)}}:[pull(i)]);};
 const client=new GithubDraftClient(i,()=>{},io);await assert.rejects(client.verifyRemote('b'.repeat(40)),/REMOTE_HEAD_MISMATCH/);assert.equal((await client.find())?.number,1);assert.equal(posts,0);
});
test('does not echo upstream secrets and refuses forged PR URL or actor revocation',async()=>{
 const i=input(),client=new GithubDraftClient(i,()=>{},async()=>Response.json({...pull(i),html_url:'https://evil.invalid/private'}));
 await assert.rejects(client.create(),/GITHUB_INVALID_RESPONSE/);
 await assert.rejects(new GithubDraftClient(i,()=>{},async()=>{throw Error(i.token)}).create(),error=>error instanceof Error&&error.message==='GITHUB_RESPONSE_UNCERTAIN');
 let calls=0;await assert.rejects(new GithubDraftClient(i,()=>{throw Error('revoked')},async()=>{calls++;return Response.json([])}).find(),/revoked/);assert.equal(calls,0);
});
test('rejects arbitrary origins, malformed refs and header injection at the input boundary',()=>{
 const i=input();for(const bad of [{repository:'https://evil.invalid/r'},{headBranch:'../main'},{headBranch:'main\nInjected'},{repository:'team/..'},{token:i.token+'\r\nLeak: true'}])assert.equal(draftPullRequestInput.safeParse({...i,...bad}).success,false);
});
