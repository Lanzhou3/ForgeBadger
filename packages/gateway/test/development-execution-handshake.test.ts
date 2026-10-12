import assert from 'node:assert/strict';
import { it,type TestContext } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runSandboxChecks,sandboxCapability } from '../src/services/development/sandbox.js';
import { executionReservation,type ExecutionIdentity } from '../src/services/development/execution-identity.js';
import { evidenceDirectory } from '../src/services/development/state-directory.js';

const unavailable=!sandboxCapability().available;
function fixture(t:TestContext,check:string){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'fb-development-handshake-'))),workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
 const db=new Database(path.join(root,'fixture.db'));fs.writeFileSync(path.join(workspace,'check.cjs'),check);
 const reservation=executionReservation(db,'fixture-user','fixture-task','fixture-owner');
 t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});return {db,root,workspace,reservation};
}
it('does not fork the check before the ready identity has been durably admitted',{skip:unavailable},async t=>{
 const f=fixture(t,"process.stdout.write('CHECK_RAN');");let ready=false;
 const result=await runSandboxChecks({workspace:f.workspace,checks:['check.cjs'],signal:new AbortController().signal,execution:{reservation:f.reservation,onReady(identity){ready=true;assert.equal(identity.phase,'ready');assert.equal(identity.supervisorPid,identity.processGroup);throw Error('fixture DB write failed');}}});
 assert.equal(ready,true);assert.equal(result.stdout,'');assert.equal(result.cancelled,true);assert.ok(fs.existsSync(f.reservation.evidencePath));
});
it('executes only after ready grant and writes nonce-bound independent stopped evidence outside sandbox access',{skip:unavailable},async t=>{
 const f=fixture(t,'');const sentinel=path.join(evidenceDirectory(f.db),'private-fixture.txt');fs.writeFileSync(sentinel,'private fixture');
 fs.writeFileSync(path.join(f.workspace,'check.cjs'),`const a=require('node:assert/strict');a.throws(()=>require('node:fs').readFileSync(${JSON.stringify(sentinel)}),/EPERM|EACCES/);process.stdout.write('CHECK_RAN');`);
 let identity:ExecutionIdentity|undefined;
 const result=await runSandboxChecks({workspace:f.workspace,checks:['check.cjs'],signal:new AbortController().signal,execution:{reservation:f.reservation,onReady(value){identity=value;assert.equal(fs.existsSync(f.reservation.evidencePath),false);}}});
 assert.equal(result.exitCode,0,result.stderr);assert.match(result.stdout,/CHECK_RAN/);
 const stopped=JSON.parse(fs.readFileSync(f.reservation.evidencePath,'utf8'));assert.deepEqual(stopped.identity,identity);assert.equal(stopped.stopped,true);
 assert.equal(fs.statSync(f.reservation.evidencePath).mode&0o777,0o600);
});
it('SIGKILL after an execution grant is unknown until independent reconciliation, never a passed or cancelled receipt',{skip:unavailable},async t=>{
 const f=fixture(t,"require('node:test').test('wait',async()=>{await new Promise(r=>setTimeout(r,5000));});");let kill:NodeJS.Timeout|undefined;
 const result=await runSandboxChecks({workspace:f.workspace,checks:['check.cjs'],signal:new AbortController().signal,execution:{reservation:f.reservation,onReady(identity){kill=setTimeout(()=>process.kill(identity.supervisorPid,'SIGKILL'),150);}}});
 if(kill)clearTimeout(kill);assert.equal(result.executionUncertain,true);assert.equal(result.exitCode,null);assert.equal(result.cancelled,false);assert.equal(fs.existsSync(f.reservation.evidencePath),false);
});
