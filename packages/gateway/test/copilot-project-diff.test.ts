import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { readProjectDiff } from '../src/services/development/project-diff.js';

function repo(t: TestContext) {
 const root = mkdtempSync(join(tmpdir(), 'fb-diff-'));
 const git = (...args: string[]) => execFileSync('git', ['-C',root, ...args], { encoding:'utf8', env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'} });
 git('init','-q');git('config','user.email','fixture@test.dev');git('config','user.name','Fixture');
 writeFileSync(join(root,'main.ts'), 'const value = 1;\n'); writeFileSync(join(root,'.env'), 'SECRET=initial\n');
 git('add','.');git('commit','-qm','initial');
 t.after(() => rmSync(root,{recursive:true,force:true})); return {root,git};
}
it('exposes staged and working source changes while omitting secret, hidden and symlink content', async t => {
 const f=repo(t);writeFileSync(join(f.root,'main.ts'),'const value = 2;\n');f.git('add','main.ts');writeFileSync(join(f.root,'main.ts'),'const value = 3;\n');
 writeFileSync(join(f.root,'.env'),'SECRET=do-not-read\n');symlinkSync('/etc/hosts',join(f.root,'escape.ts'));
 writeFileSync(join(f.root,'new.ts'),'const token = "sk-FAKETOKEN123456";\n');
 const staged=await readProjectDiff(f.root,{mode:'staged'});
 assert.match(JSON.stringify(staged), /value = 1/);assert.match(JSON.stringify(staged), /value = 2/);assert.doesNotMatch(JSON.stringify(staged),/value = 3/);
 const working=await readProjectDiff(f.root,{mode:'working',includeUntracked:true});
 assert.match(JSON.stringify(working), /value = 3/);assert.match(JSON.stringify(working), /REDACTED/);
 assert.doesNotMatch(JSON.stringify(working),/do-not-read|sk-FAKETOKEN123456|localhost/);
 assert.ok(createPlatformTools().some(tool=>tool.name==='read_project_diff'));
});
it('never executes external diff, textconv or fsmonitor and handles literal unusual paths', async t => {
 const f=repo(t), marker=join(f.root,'executed');
 const command=`touch ${marker}`;
 f.git('config','diff.external',command);f.git('config','diff.evil.textconv',command);f.git('config','core.fsmonitor',command);
 writeFileSync(join(f.root,'.gitattributes'),'*.ts diff=evil\n');
 writeFileSync(join(f.root,'main.ts'),'changed\n');writeFileSync(join(f.root,'[literal] name.ts'),'new\n');
 const result=await readProjectDiff(f.root,{mode:'working',includeUntracked:true});
 assert.ok(result.files.some(file=>file.path==='[literal] name.ts'));assert.equal(existsSync(marker),false);
});
it('rejects parent discovery, external gitdir and cancellation', async t => {
 const f=repo(t);mkdirSync(join(f.root,'nested'));
 await assert.rejects(readProjectDiff(join(f.root,'nested'),{mode:'working'}),/GIT_ROOT/);
 await assert.rejects(readProjectDiff(f.root,{mode:'working'},AbortSignal.abort()),/abort/i);
 renameSync(join(f.root,'.git'),join(f.root,'git-data'));writeFileSync(join(f.root,'.git'),'gitdir: git-data\n');
 await assert.rejects(readProjectDiff(f.root,{mode:'working'}),/GIT_ROOT/);
});
it('does not follow renamed hidden files or gitlinks, and reports oversized files as skipped', async t => {
 const f=repo(t); f.git('mv','.env','exposed.ts');
 // Renaming a protected path must not make its indexed blob readable.
 f.git('update-index','--add','--cacheinfo','160000',f.git('rev-parse','HEAD').trim(),'submodule');
 writeFileSync(join(f.root,'main.ts'),'x'.repeat(70000));
 const result=await readProjectDiff(f.root,{mode:'working'});
 assert.ok(result.skipped > 0);assert.equal(result.files.some(file=>file.path==='submodule' || file.path==='exposed.ts'),false);
 assert.doesNotMatch(JSON.stringify(await readProjectDiff(f.root,{mode:'staged'})),/SECRET=initial/);
});

it('bounds candidate scanning and supports unborn repositories and staged deletions', async t => {
 const f=repo(t);
 for (let i=0;i<45;i++) writeFileSync(join(f.root,`file-${String(i).padStart(2,'0')}.ts`),'same\n');
 f.git('add','.');f.git('commit','-qm','many files');
 writeFileSync(join(f.root,'main.ts'),'last change\n');
 const first=await readProjectDiff(f.root,{mode:'working'});
 assert.equal(first.files.length,0);assert.equal(first.nextOffset,40);
 assert.equal(first.repositoryStatus,'not_assessed');assert.match(first.note,/get_project_git_status/);
 const second=await readProjectDiff(f.root,{mode:'working',offset:first.nextOffset!});
 assert.equal(second.nextOffset,null);assert.equal(second.files[0]?.path,'main.ts');
 f.git('rm','-f','main.ts');
 const deletion=await readProjectDiff(f.root,{mode:'staged',offset:40});
 assert.equal(deletion.files.find(file=>file.path==='main.ts')?.status,'deleted');
 f.git('checkout','--orphan','empty'); f.git('rm','-rf','.');
 writeFileSync(join(f.root,'new.ts'),'initial\n');f.git('add','new.ts');
 const unborn=await readProjectDiff(f.root,{mode:'staged'});
 assert.equal(unborn.files[0]?.status,'added');
});

it('cannot lazy-fetch missing partial-clone objects or execute a configured transport helper', async t => {
 const f=repo(t), marker=join(f.root,'ssh-executed');
 f.git('update-index','--add','--cacheinfo','100644','f'.repeat(40),'missing.ts');
 f.git('config','remote.origin.url','ssh://invalid.example/repo');
 f.git('config','remote.origin.promisor','true');
 f.git('config','extensions.partialClone','origin');
 f.git('config','core.sshCommand',`touch ${marker}; exit 1; #`);
 const result=await readProjectDiff(f.root,{mode:'working'});
 assert.equal(existsSync(marker),false,'read-only inspection must never launch configured SSH');
 assert.ok(result.skipped >= 1);
});

it('rejects nested Git object and reference symlinks before reading outside blobs', async t => {
 for (const relative of ['objects/fanout', 'objects/loose', 'objects/pack/fixture.pack', 'refs/heads/external']) {
  const f=repo(t), outside=repo(t);
  if (relative === 'objects/fanout' || relative === 'objects/loose') {
   writeFileSync(join(outside.root,'private.ts'),'OUTSIDE_PRIVATE_FIXTURE\n');
   const oid=outside.git('hash-object','-w','private.ts').trim();
   f.git('update-index','--add','--cacheinfo','100644',oid,'public.ts');
   const fanout=join(f.root,'.git','objects',oid.slice(0,2));
   if (relative.endsWith('fanout')) {
    rmSync(fanout,{recursive:true,force:true});
    symlinkSync(join(outside.root,'.git','objects',oid.slice(0,2)),fanout);
   } else {
    mkdirSync(fanout,{recursive:true});
    symlinkSync(join(outside.root,'.git','objects',oid.slice(0,2),oid.slice(2)),join(fanout,oid.slice(2)));
   }
  } else symlinkSync(join(outside.root,'main.ts'),join(f.root,'.git',relative));
  await assert.rejects(readProjectDiff(f.root,{mode:'working'}),/GIT_ROOT/);
 }
});
