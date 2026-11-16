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

import {parseSkillResourceManifest,assertNoObsoleteSkillResources,readSkillResourceManifest,MAX_RESOURCE_FILES,MAX_RESOURCE_BYTES,MAX_RESOURCE_FILE_BYTES} from '../src/services/skill-resources.js';
import {validateSkillFiles,storedSkillFiles} from '../src/services/skill-package.js';
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

it('ignores generated caches while preserving Skill source resources', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'fb-skill-caches-'));
 try {
  mkdirSync(path.join(root, 'scripts/__pycache__'), {recursive:true});
  mkdirSync(path.join(root, '.pytest_cache'), {recursive:true});
  writeFileSync(path.join(root, 'SKILL.md'), '# Video');
  writeFileSync(path.join(root, 'scripts/synth.py'), 'print("audio")');
  writeFileSync(path.join(root, 'scripts/__pycache__/synth.cpython-312.pyc'), Buffer.from([0xff, 0]));
  writeFileSync(path.join(root, 'scripts/old.pyo'), Buffer.from([0xff, 0]));
  writeFileSync(path.join(root, '.pytest_cache/SKILL.md'), '# Cached fake Skill');
  writeFileSync(path.join(root, '.DS_Store'), Buffer.from([0xff, 0]));
  const rejected:string[] = [];
  const skills = discoverLocalSkills({roots:[root], onRejected:(_path, reason) => rejected.push(reason)});
  assert.deepEqual(rejected, []);
  assert.equal(skills.length, 1);
  assert.deepEqual(parseSkillResourceManifest(skills[0]!.resourceManifest), [
   {relativePath:'scripts/synth.py', content:'print("audio")'}
  ]);
 } finally {rmSync(root, {recursive:true, force:true});}
});

it('imports and exports a large documentation Skill without truncating its resources', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'fb-large-skill-'));
 try {
  const dir = path.join(root, 'guidance');
  mkdirSync(path.join(dir, 'guides'), {recursive:true});
  writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: guidance\ndescription: Web guidance\n---\n# Guidance');
  for (let index = 0; index < 209; index++) {
   writeFileSync(path.join(dir, `guides/guide-${index}.md`), `# Guide ${index}\n${'x'.repeat(10000)}`);
  }
  const rejected:string[] = [];
  const [skill] = discoverLocalSkills({roots:[dir], onRejected:(_path, reason) => rejected.push(reason)});
  assert.deepEqual(rejected, []);
  assert.ok(skill);
  assert.equal(parseSkillResourceManifest(skill.resourceManifest).length, 209);
  assert.equal(validateSkillFiles(storedSkillFiles(skill)).length, 210);
  const files = buildProjectConfigFiles({adapter:'codex', templateFiles:[], skills:[{
   ...skill, skillId:'large', description:skill.description??null, isEnabled:true, selectionState:'inherited_enabled'
  }]});
  for (const file of files) {
   const dest = path.join(root, 'export', file.relativePath);
   mkdirSync(path.dirname(dest), {recursive:true});
   writeFileSync(dest, file.content);
  }
  const exportedRoot = path.join(root, 'export/.agents/skills');
  assert.doesNotThrow(() => assertNoObsoleteSkillResources(path.join(root, 'export'), '.agents/skills', files));
  const [roundtrip] = discoverLocalSkills({roots:[exportedRoot]});
  assert.ok(roundtrip);
  assert.deepEqual(storedSkillFiles(roundtrip), storedSkillFiles(skill));
 } finally {rmSync(root, {recursive:true, force:true});}
});

it('identifies the offending resource and rejects the complete package', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'fb-skill-diagnostics-'));
 try {
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'SKILL.md'), '# Skill');
  const file = path.join(root, 'assets/broken.dat');
  for (const [content, reason] of [
   [Buffer.from([0xff]), /assets\/broken\.dat.*UTF-8/],
   [Buffer.from([0]), /assets\/broken\.dat.*binary/],
   [Buffer.alloc(128 * 1024 + 1, 120), /assets\/broken\.dat.*128 KiB/]
  ] as const) {
   writeFileSync(file, content);
   assert.throws(() => readSkillResourceManifest(path.join(root, 'SKILL.md')), reason);
   const rejected:string[] = [];
   assert.deepEqual(discoverLocalSkills({roots:[root], onRejected:(_path, message) => rejected.push(message)}), []);
   assert.match(rejected[0]!, reason);
  }
 } finally {rmSync(root, {recursive:true, force:true});}
});

it('roundtrips the file-count boundary and long export metadata, then rejects one extra resource', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'fb-skill-file-limit-'));
 const exported = mkdtempSync(path.join(tmpdir(), 'fb-skill-export-limit-'));
 try {
  const prefix = `guides/${'a'.repeat(160)}/${'b'.repeat(160)}`;
  mkdirSync(path.join(root, prefix), {recursive:true});
  writeFileSync(path.join(root, 'SKILL.md'), '# Skill');
  for (let index = 0; index < MAX_RESOURCE_FILES; index++) {
   writeFileSync(path.join(root, prefix, `${index}.md`), 'guide');
  }
  const [skill] = discoverLocalSkills({roots:[root]});
  assert.ok(skill);
  assert.equal(validateSkillFiles(storedSkillFiles(skill)).length, MAX_RESOURCE_FILES + 1);
  const files = buildProjectConfigFiles({templateFiles:[], skills:[{
   ...skill, skillId:'max', description:null, isEnabled:true, selectionState:'inherited_enabled'
  }]});
  const manifest = files.find(file => file.relativePath.endsWith('.forgebadger-skill.json'))!;
  assert.ok(Buffer.byteLength(manifest.content) > 64 * 1024);
  writeFileSync(path.join(root, '.forgebadger-skill.json'), manifest.content);
  assert.equal(parseSkillResourceManifest(readSkillResourceManifest(path.join(root, 'SKILL.md'))).length, MAX_RESOURCE_FILES);
  for (const file of files) {
   const dest = path.join(exported, file.relativePath);
   mkdirSync(path.dirname(dest), {recursive:true});
   writeFileSync(dest, file.content);
  }
  assert.doesNotThrow(() => assertNoObsoleteSkillResources(exported, '.claude/skills', files));
  const [roundtrip] = discoverLocalSkills({roots:[path.join(exported, '.claude/skills')]});
  assert.ok(roundtrip);
  assert.equal(parseSkillResourceManifest(roundtrip.resourceManifest).length, MAX_RESOURCE_FILES);
  writeFileSync(path.join(root, 'extra.md'), 'extra');
  assert.throws(() => readSkillResourceManifest(path.join(root, 'SKILL.md')), /\.md:.*256.*file count limit/);
  assert.throws(() => validateSkillFiles([...storedSkillFiles(skill), {path:'extra.md', content:'extra'}]));
 } finally {
  rmSync(root, {recursive:true, force:true});
  rmSync(exported, {recursive:true, force:true});
 }
});

it('enforces the total package byte boundary including SKILL.md during discovery and validation', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'fb-skill-byte-limit-'));
 try {
  const main = '# Skill';
  writeFileSync(path.join(root, 'SKILL.md'), main);
  let remaining = MAX_RESOURCE_BYTES - Buffer.byteLength(main);
  for (let index = 0; remaining > 0; index++) {
   const size = Math.min(remaining, MAX_RESOURCE_FILE_BYTES);
   writeFileSync(path.join(root, `${String(index).padStart(3, '0')}.md`), 'x'.repeat(size));
   remaining -= size;
  }
  const [skill] = discoverLocalSkills({roots:[root]});
  assert.ok(skill);
  const files = storedSkillFiles(skill);
  assert.doesNotThrow(() => validateSkillFiles(files));
  writeFileSync(path.join(root, 'extra.md'), 'x');
  assert.throws(() => readSkillResourceManifest(path.join(root, 'SKILL.md')), /extra\.md:.*4 MiB total size limit/);
  assert.throws(() => validateSkillFiles([...files, {path:'extra.md', content:'x'}]), /4 MiB/);
 } finally {rmSync(root, {recursive:true, force:true});}
});

it('still rejects resource symlinks and preserves the source files', () => {
 const root = mkdtempSync(path.join(tmpdir(), 'fb-skill-link-resource-'));
 try {
  writeFileSync(path.join(root, 'SKILL.md'), '# Skill');
  writeFileSync(path.join(root, 'real.txt'), 'keep');
  symlinkSync(path.join(root, 'real.txt'), path.join(root, 'linked.txt'));
  assert.throws(() => readSkillResourceManifest(path.join(root, 'SKILL.md')), /linked\.txt:.*symlinks/);
  assert.equal(requireRead(path.join(root, 'real.txt')), 'keep');
 } finally {rmSync(root, {recursive:true, force:true});}
});

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
