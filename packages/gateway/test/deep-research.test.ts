import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { CopilotMachineRootRepository } from '../src/db/repositories/copilot-machine-root-repository.js';
import { verifyEvidence } from '../src/services/agent/retrieval-grounding.js';
import { createDeepResearchTools } from '../src/services/agent/tools/deep-research.js';

it('verifyEvidence accepts a present citation and falsifies absent ones', () => {
  assert.deepEqual(verifyEvidence('const answer = 42;', 'const answer = 42', 'entailed', 1), { verified: true, grounded: 'entailed', present: true });
  assert.deepEqual(verifyEvidence('const answer = 42;', 'const missing = 0', 'entailed', 1), { verified: false, grounded: 'unrelated', present: false, reason: 'SNIPPET_NOT_FOUND' });
  assert.deepEqual(verifyEvidence(undefined, 'x', 'supported', 99), { verified: false, grounded: 'unrelated', present: false, reason: 'LINE_OUT_OF_RANGE' });
  // whitespace reflow does not break the citation
  assert.equal(verifyEvidence('const  answer    =\t42;', 'const answer = 42', 'supported', 1).verified, true);
});

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  migrate(drizzle(db), { migrationsFolder: fileURLToPath(new URL('../src/db/migrations', import.meta.url)) });
  const userId = new UserRepository(db).create('dr@test.dev', 'hash').id;
  const dir = mkdtempSync(path.join(tmpdir(), 'fb-deep-research-'));
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'alpha.ts'), 'const answer = 42;\nexport {};\n');
  return { db, userId, dir };
}

it('verify_retrieval_evidence tool grounds a real citation and falsifies a fabricated one', async () => {
  const f = fixture();
  try {
    const tools = Object.fromEntries(createDeepResearchTools().map(t => [t.name, t]));
    const verify = tools.verify_retrieval_evidence!;
    const root = new CopilotMachineRootRepository(f.db, f.userId).register('home', f.dir)!;
    const good = await verify.execute({ root: root.id, path: 'src/alpha.ts', line: 1, snippet: 'const answer = 42', proposedGrounding: 'entailed' }, f);
    assert.equal(good.verified, true);
    assert.equal(good.grounded, 'entailed');
    const wrongLine = await verify.execute({ root: root.id, path: 'src/alpha.ts', line: 99, snippet: 'const answer = 42', proposedGrounding: 'entailed' }, f);
    assert.deepEqual({ verified: wrongLine.verified, grounded: wrongLine.grounded, reason: wrongLine.reason }, { verified: false, grounded: 'unrelated', reason: 'LINE_OUT_OF_RANGE' });
    const wrongSnip = await verify.execute({ root: root.id, path: 'src/alpha.ts', line: 1, snippet: 'the quick brown fox', proposedGrounding: 'entailed' }, f);
    assert.equal(wrongSnip.reason, 'SNIPPET_NOT_FOUND');
    await assert.rejects(verify.execute({ root: 'nope', path: 'src/alpha.ts', line: 1, snippet: 'x', proposedGrounding: 'entailed' }, f), /MACHINE_ROOT_NOT_FOUND/);
  } finally { f.db.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
