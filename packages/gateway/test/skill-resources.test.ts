import assert from 'node:assert/strict';
import {it} from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {discoverLocalSkills} from '../src/services/local-skills.js';
import {buildProjectConfigFiles} from '../src/services/project-config-files.js';
it('preserves complete UTF-8 package resources and frontmatter',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-package-'));
 try {
  mkdirSync(path.join(root,'review/scripts'),{recursive:true});
  const content='---\nname: review\ndescription: "Review: carefully"\ncustom: keep\n---\n# Review\nUse scripts/check.py';
  writeFileSync(path.join(root,'review/SKILL.md'),content);
  writeFileSync(path.join(root,'review/scripts/check.py'),'print("check")');
  const skill=discoverLocalSkills({roots:[root]})[0]!;
  const files=buildProjectConfigFiles({adapter:'codex',templateFiles:[],skills:[{...skill,skillId:'x',description:skill.description??null,isEnabled:true,selectionState:'inherited_enabled'}]});
  assert.equal(files.find(f=>f.relativePath.endsWith('SKILL.md'))?.content,content);
  assert.equal(files.find(f=>f.relativePath.endsWith('scripts/check.py'))?.content,'print("check")');
 } finally {rmSync(root,{recursive:true,force:true});}
});
it('does not follow discovery symlinks outside approved roots',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-skill-root-'));const other=mkdtempSync(path.join(tmpdir(),'fb-skill-out-'));
 try {writeFileSync(path.join(other,'SKILL.md'),'# secret');symlinkSync(other,path.join(root,'escape'));assert.equal(discoverLocalSkills({roots:[root]}).length,0);}
 finally {rmSync(root,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});

import {parseSkillResourceManifest,assertNoObsoleteSkillResources} from '../src/services/skill-resources.js';
import {createRenderPlan} from '../src/config-generation/render.js';

it('preserves template-like syntax inside CLI resources through final render',()=>{
 const skill={skillId:'raw',name:'raw',description:null,source:'local',version:'1',isEnabled:true,selectionState:'inherited_enabled' as const,content:'# Raw\n{{projectName}} {{unbound}}',
 resourceManifest:JSON.stringify({version:1,kind:'utf8-package',sourcePath:'/fixture/SKILL.md',files:[{relativePath:'templates/file.txt',content:'{{ user.value }}'}]})};
 const templateFiles=buildProjectConfigFiles({templateFiles:[],skills:[skill]});
 const plan=createRenderPlan({projectId:'p',targetRoot:'/tmp',templateId:'t',variables:{projectName:'substitution'},templateFiles,credentialMode:'host_environment',dryRun:true});
 assert.match(plan.files.find(f=>f.relativePath.endsWith('SKILL.md'))!.content,/\{\{projectName\}\} \{\{unbound\}\}/);
 assert.equal(plan.files.find(f=>f.relativePath.endsWith('file.txt'))!.content,'{{ user.value }}');
});

it('rejects manifest escapes, binary data, duplicate and parent-child config paths',()=>{
 const manifest=(files:unknown[])=>JSON.stringify({version:1,kind:'utf8-package',sourcePath:'/fixture/SKILL.md',files});
 for(const relativePath of ['../outside','/absolute','a\\b','a/%2e%2e/b','CON','a/../b','SKILL.md']) {
   assert.throws(()=>parseSkillResourceManifest(manifest([{relativePath,content:'bad'}])));
 }
 assert.throws(()=>parseSkillResourceManifest(manifest([{relativePath:'file',content:'\0'}])));
 const skill={skillId:'x',name:'review',description:null,source:'local',version:'1',isEnabled:true,selectionState:'inherited_enabled' as const,content:'# Review'};
 assert.throws(()=>buildProjectConfigFiles({templateFiles:[{id:'t',relativePath:'.claude/skills/review/SKILL.md',content:'collision'}],skills:[skill]}),/Duplicate/);
 assert.throws(()=>buildProjectConfigFiles({templateFiles:[{id:'t',relativePath:'.claude/skills/review',content:'file'}],skills:[skill]}),/collision/);
 assert.throws(()=>buildProjectConfigFiles({templateFiles:[],skills:[skill,{...skill,skillId:'y',name:'REVIEW'}]}),/Duplicate/);
});

it('reports rejected packages instead of silently importing partial contents',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-invalid-resources-'));
 try {
  const dir=path.join(root,'skill');mkdirSync(dir);writeFileSync(path.join(dir,'SKILL.md'),'# Skill');writeFileSync(path.join(dir,'asset.bin'),Buffer.from([0,255]));
  const errors:string[]=[];
  assert.equal(discoverLocalSkills({roots:[root],onRejected:(_path,reason)=>errors.push(reason)}).length,0);
  assert.equal(errors.length,1);
  writeFileSync(path.join(dir,'asset.bin'),'x'.repeat(128*1024+1));
  assert.equal(discoverLocalSkills({roots:[root],onRejected:(_path,reason)=>errors.push(reason)}).length,0);
  assert.match(errors[1]!,/size limit/);
 } finally {rmSync(root,{recursive:true,force:true});}
});

it('detects obsolete tracked resources and leaves modified files untouched',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-obsolete-resources-'));
 try {
  const dir=path.join(root,'.agents/skills/review');mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'old.py'),'user edited');
  writeFileSync(path.join(dir,'.forgebadger-skill.json'),JSON.stringify({version:1,files:[{relativePath:'old.py',sha256:'a'.repeat(64)}]}));
  assert.throws(()=>assertNoObsoleteSkillResources(root,'.agents/skills',[]),/old.py/);
  assert.equal(requireRead(path.join(dir,'old.py')),'user edited');
 }finally{rmSync(root,{recursive:true,force:true});}
});
import {readFileSync as requireReadFile} from 'node:fs';
function requireRead(file:string){return requireReadFile(file,'utf8');}

it('roundtrips exported packages and validates export metadata',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-roundtrip-package-'));
 try {
  const skill={skillId:'x',name:'roundtrip',description:null,source:'local',version:'1',isEnabled:true,selectionState:'inherited_enabled' as const,content:'# Roundtrip',resourceManifest:JSON.stringify({version:1,kind:'utf8-package',sourcePath:'/fixture/SKILL.md',files:[{relativePath:'check.py',content:'print("ok")'}]})};
  const files=buildProjectConfigFiles({templateFiles:[],skills:[skill]});
  for(const file of files){const dest=path.join(root,file.relativePath);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,file.content);}
  const imported=discoverLocalSkills({roots:[path.join(root,'.claude/skills')]});
  assert.equal(imported.length,1);
  assert.deepEqual(parseSkillResourceManifest(imported[0]!.resourceManifest),[{relativePath:'check.py',content:'print("ok")'}]);
  writeFileSync(path.join(root,'.claude/skills/roundtrip/.forgebadger-skill.json'),'{"version":99}');
  const rejected:string[]=[];
  assert.equal(discoverLocalSkills({roots:[path.join(root,'.claude/skills')],onRejected:(_path,reason)=>rejected.push(reason)}).length,0);
  assert.equal(rejected.length,1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
