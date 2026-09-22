import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { TemplateRepository } from '../src/db/repositories/template-repository.js';
import { listCopilotPlaybooks } from '../src/services/agent/skills/skill-queries.js';
import { buildProjectConfigRenderPlan } from '../src/services/project-config-render.js';
import { LEGACY_COPILOT_SKILLS } from '../src/services/agent/skills/legacy-copilot-skills.js';

for (const [adapter, directory] of [
  ['claude', '.claude/skills'], ['codex', '.agents/skills'],
  ['opencode', '.opencode/skills'], ['kimi', '.kimi-code/skills']
] as const) {
  it(`${adapter} render rejects existing legacy playbooks and preserves original and user-edited bytes`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'fb-playbook-render-'));
    const db = new Database(':memory:');
    try {
      migrate(drizzle(db), { migrationsFolder: new URL('../src/db/migrations/', import.meta.url).pathname });
      const user = new UserRepository(db).create(`render-${adapter}@test.dev`, 'hash');
      const template = new TemplateRepository(db, user.id).create({
        name: 'bounded template', adapter, files: [{ filePath: 'AGENTS.md', content: '# Project', fileType: 'markdown' }]
      });
      const project = new ProjectRepository(db, user.id).create({ name: 'project', path: root, aiTool: adapter, templateId: template.id });
      listCopilotPlaybooks(db, user.id, { availableToolNames: [] });
      const render = () => buildProjectConfigRenderPlan(db, user.id, project.id, template.id, 'host_environment', true, { syncSkills: () => undefined });
      const clean = await render();
      assert.equal(clean.files.some(file => LEGACY_COPILOT_SKILLS.some(book => file.relativePath.includes(book.name))), false);
      const legacy = LEGACY_COPILOT_SKILLS[0]!;
      const relative = `${directory}/${legacy.name}/SKILL.md`;
      const target = path.join(root, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      for (const content of [legacy.body, `${legacy.body}\nOwner-local changes retained`]) {
        writeFileSync(target, content);
        await assert.rejects(render, (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /legacy Copilot playbooks require owner review/i);
          assert.ok(error.message.includes(relative));
          assert.match(error.message, /no files removed/i);
          return true;
        });
        assert.equal(readFileSync(target, 'utf8'), content);
      }
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

import {syncLocalSkills} from '../src/services/local-skills.js';
import {SkillRepository} from '../src/db/repositories/skill-repository.js';
it('blocks selected stale snapshots after an invalid source package refresh',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'fb-stale-package-'));const db=new Database(':memory:');
 try {
  migrate(drizzle(db),{migrationsFolder:new URL('../src/db/migrations/',import.meta.url).pathname});
  const user=new UserRepository(db).create('stale-package@test.dev','hash');
  const source=path.join(root,'source/review');mkdirSync(source,{recursive:true});
  writeFileSync(path.join(source,'SKILL.md'),'# Review');writeFileSync(path.join(source,'check.py'),'print("old")');
  const template=new TemplateRepository(db,user.id).create({name:'template',adapter:'codex',files:[]});
  const project=new ProjectRepository(db,user.id).create({name:'project',path:root,aiTool:'codex'});
  const options={syncSkills:(repo:Parameters<typeof syncLocalSkills>[0])=>syncLocalSkills(repo,{roots:[path.join(root,'source')]})};
  const render=()=>buildProjectConfigRenderPlan(db,user.id,project.id,template.id,'host_environment',true,options);
  assert.ok((await render()).files.some(file=>file.relativePath.endsWith('/check.py')));
  const repo=new SkillRepository(db,user.id);const snapshot=repo.getByName('review')!;
  writeFileSync(path.join(source,'check.py'),Buffer.from([0,255]));
  writeFileSync(path.join(source,'SKILL.md'),'---\nname: renamed-review\n---\n# Renamed during invalid refresh');
  await assert.rejects(render,/refresh rejected.*stale snapshots.*review/);
  assert.equal(repo.getById(snapshot.id)?.resourceManifest,snapshot.resourceManifest);
  writeFileSync(path.join(source,'check.py'),'print("restored resource")');
  for(const invalid of ['', 'x'.repeat(128*1024+1), Buffer.from([0,255])]) {
    writeFileSync(path.join(source,'SKILL.md'),invalid);
    await assert.rejects(render,/refresh rejected.*stale snapshots.*review/);
    assert.equal(repo.getById(snapshot.id)?.resourceManifest,snapshot.resourceManifest);
  }
  repo.toggle(snapshot.id,false);
  assert.equal((await render()).files.some(file=>file.relativePath.endsWith('/check.py')),false);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
