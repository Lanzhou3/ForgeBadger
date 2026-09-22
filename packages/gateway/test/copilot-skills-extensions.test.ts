import assert from 'node:assert/strict';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { SkillRepository } from '../src/db/repositories/skill-repository.js';
import { CopilotSkillService } from '../src/services/agent/skills/copilot-skill-service.js';
function fixture() {
 const db=new Database(':memory:');migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
 const user=new UserRepository(db).create('extensions@test.dev','hash');
 return {db,user,service:new CopilotSkillService(db,user.id)};
}
const files=[{path:'SKILL.md',content:'---\nname: inspect-project\ndescription: Inspect project evidence\nversion: 1.0.0\nrequired-tools:\n  - get_project\n---\nRead references/checklist.md.'},{path:'references/checklist.md',content:'# Checklist\nInspect results.'}];
it('imports complete Skill packages disabled, independently from CLI, with immutable revisions',()=>{
 const f=fixture();try{
  const imported=f.service.importFiles({kind:'upload',label:'package'},files);
  assert.equal(imported.kind,'imported');assert.equal(imported.isEnabled,false);
  assert.deepEqual(imported.files,files);assert.equal(imported.compatible,true);
  assert.equal(new SkillRepository(f.db,f.user.id).getById(imported.id),undefined);
  const enabled=f.service.setEnabled(imported.id,true,imported.revisionId,{availableToolNames:['get_project']});
  assert.equal(enabled.available,true);
  const changed=f.service.update(imported.id,{expectedRevisionId:imported.revisionId,files:[{...files[0]!,content:files[0]!.content.replace('1.0.0','2.0.0')},files[1]!]});
  assert.notEqual(changed.revisionId,imported.revisionId);
  assert.throws(()=>f.service.update(imported.id,{expectedRevisionId:imported.revisionId,files}),/changed|revision/i);
  const restored=f.service.rollback(imported.id,imported.revisionId,changed.revisionId);
  assert.equal(restored.version,'1.0.0');assert.notEqual(restored.revisionId,imported.revisionId);
  assert.deepEqual(f.service.revision(imported.id,imported.revisionId)?.files,files);
  assert.equal(f.service.revisions(imported.id).length,3);
 }finally{f.db.close();}
});
it('rejects traversal and invalid packages while retained execution-dependent packages remain incompatible',()=>{
 const f=fixture();try{
  assert.throws(()=>f.service.importFiles({kind:'paste'},[{path:'../SKILL.md',content:files[0]!.content}]),/path/i);
  assert.throws(()=>f.service.importFiles({kind:'paste'},[{path:'SKILL.md',content:'# no metadata'}]),/frontmatter/i);
  const unsupported=f.service.importFiles({kind:'upload'},[...files,{path:'scripts/check.sh',content:'echo hello'}]);
  assert.equal(unsupported.compatible,false);assert.ok(unsupported.incompatibilityReasons.some(r=>r.includes('script')));
  assert.throws(()=>f.service.setEnabled(unsupported.id,true,unsupported.revisionId),/incompatible/i);
 }finally{f.db.close();}
});
it('pins resource reads to current revision and denies disabled, foreign, Grant and traversal reads',()=>{
 const f=fixture();try{
  const imported=f.service.importFiles({kind:'upload'},files);
  const input={skillId:imported.id,revisionId:imported.revisionId,relativePath:'references/checklist.md'};
  assert.deepEqual(f.service.readResource(input,{availableToolNames:['get_project']}),{found:false});
  f.service.setEnabled(imported.id,true,imported.revisionId);
  assert.equal(f.service.readResource(input,{availableToolNames:['get_project']}).found,true);
  assert.equal(f.service.readResource(input,{availableToolNames:['get_project'],grantBound:true}).found,false);
  assert.throws(()=>f.service.readResource({...input,relativePath:'../private'}),/path/i);
  const other=new UserRepository(f.db).create('other-extensions@test.dev','hash');
  const foreign=new CopilotSkillService(f.db,other.id);
  assert.equal(foreign.get(imported.id),undefined);
  assert.throws(()=>foreign.setEnabled(imported.id,true,imported.revisionId),/not found/i);
  assert.throws(()=>foreign.revisions(imported.id),/not found/i);
  assert.deepEqual(foreign.readResource(input,{availableToolNames:['get_project']}),{found:false});
  f.service.update(imported.id,{expectedRevisionId:imported.revisionId,files:[files[0]!,{...files[1]!,content:'updated resource'}]});
  assert.deepEqual(f.service.readResource(input,{availableToolNames:['get_project']}),{found:false});
 }finally{f.db.close();}
});
it('retains CLI-specific permission syntax as incompatible metadata and never accepts builtin impersonation',()=>{
 const f=fixture();try{
  const imported=f.service.importFiles({kind:'paste'},[{path:'SKILL.md',content:'---\nname: cli-guide\ndescription: CLI guide\nallowed-tools: Bash(git:*)\nhooks: {}\n---\nRun the CLI.'}]);
  assert.equal(imported.compatible,false);
  assert.ok(imported.incompatibilityReasons.some(reason=>reason.includes('permission_syntax')));
  assert.ok(imported.incompatibilityReasons.some(reason=>reason.includes('hooks')));
  assert.throws(()=>f.service.importFiles({kind:'paste'},[{path:'SKILL.md',content:files[0]!.content.replace('inspect-project','safety-and-approvals')}]),/reserved/i);
  assert.throws(()=>f.service.importFiles({kind:'builtin'},files),/source/i);
 }finally{f.db.close();}
});
it('validates duplicate, colliding, binary, oversized and aliased YAML packages before any insert',()=>{
 const f=fixture();try{
  for(const invalid of [
   [...files,{path:'skill.md',content:'duplicate'}],
   [...files,{path:'references',content:'collision'}],
   [...files,{path:'binary.txt',content:'bad\0bytes'}],
   [...files,{path:'large.txt',content:'x'.repeat(128*1024+1)}],
   [{path:'SKILL.md',content:'---\nname: x\ndescription: &a [one]\ncopy: *a\n---\nX'}],
   [{path:'SKILL.md',content:'---\nname: x\nname: y\ndescription: duplicate\n---\nX'}]
  ]) assert.throws(()=>f.service.importFiles({kind:'upload'},invalid));
  assert.equal(new SkillRepository(f.db,f.user.id,'copilot').listOwnedBySource('copilot-import').length,0);
 }finally{f.db.close();}
});
it('preserves canonical Grant trust only for the exact builtin package, never added resources',()=>{
 const f=fixture();try{
  const builtin=f.service.details({availableToolNames:[]}).find(row=>row.name==='safety-and-approvals')!;
  assert.equal(f.service.get(builtin.id,{availableToolNames:[],grantBound:true})?.available,true);
  const changed=f.service.update(builtin.id,{expectedRevisionId:builtin.revisionId,files:[...builtin.files,{path:'references/secret.md',content:'private owner data'}]});
  assert.equal(f.service.get(builtin.id,{availableToolNames:[],grantBound:true})?.available,false);
  assert.deepEqual(f.service.readResource({skillId:builtin.id,revisionId:changed.revisionId,relativePath:'references/secret.md'},{availableToolNames:[],grantBound:true}),{found:false});
  assert.equal(f.service.readResource({skillId:builtin.id,revisionId:changed.revisionId,relativePath:'references/secret.md'},{availableToolNames:[]}).found,true);
 }finally{f.db.close();}
});
it('bounds installed external packages and resource payloads without mutating retained packages',()=>{
 const f=fixture();try{
  const root=files[0]!;
  const many=Array.from({length:65},(_,index)=>({path:`references/${index}.md`,content:'x'}));
  assert.throws(()=>f.service.importFiles({kind:'upload'},[root,...many]));
  assert.throws(()=>f.service.importFiles({kind:'upload'},[root,...Array.from({length:8},(_,index)=>({path:`references/${index}.md`,content:'x'.repeat(128*1024)}))]),/total size/);
  for(let index=0;index<32;index++) f.service.importFiles({kind:'paste'},[{...root,content:root.content.replace('inspect-project',`guide-${index}`)}]);
  assert.throws(()=>f.service.importFiles({kind:'paste'},files),/limit reached/);
  assert.equal(new SkillRepository(f.db,f.user.id,'copilot').listOwnedBySource('copilot-import').length,32);
 }finally{f.db.close();}
});
