/** Offline real-catalog evaluation. No network, secrets or production DB. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { discoverToolSchemas } from '../src/services/agent/tool-discovery.js';

const source = readFileSync(new URL('../evaluations/fixtures/discovery-v1.json', import.meta.url), 'utf8');
const fixture = JSON.parse(source) as { version: number; cases: Array<{split:string;query:string;expected:string|null}> };
const catalog = createAgentToolRegistry(createPlatformTools()).toModelSchemas();
const cases = fixture.cases.map(item => {
  const started = performance.now();
  const found = discoverToolSchemas(catalog, item.query, 3).map(tool => tool.name);
  return {...item, found, passed: item.expected === null ? found.length === 0 : found.includes(item.expected),
    rank: item.expected === null ? null : found.indexOf(item.expected) + 1 || null, elapsedMs: performance.now() - started};
});
const report = {createdAt:new Date().toISOString(), kind:'offline-discovery', fixtureVersion:fixture.version,
  fixtureHash:createHash('sha256').update(source).digest('hex'),
  catalogHash:createHash('sha256').update(JSON.stringify(catalog)).digest('hex'),
  modelCalls:0, tokens:null, costUsd:null, cases,
  summary:['development','holdout'].map(split=>({split,total:cases.filter(c=>c.split===split).length,
    passed:cases.filter(c=>c.split===split&&c.passed).length}))};
const json = JSON.stringify(report,null,2)+'\n';
if(process.argv[2])writeFileSync(process.argv[2],json);else process.stdout.write(json);
console.log(JSON.stringify(report.summary));
