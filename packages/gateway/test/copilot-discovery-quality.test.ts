import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { discoverToolSchemas } from '../src/services/agent/tool-discovery.js';

const catalog = createAgentToolRegistry(createPlatformTools()).toModelSchemas();
const fixture = JSON.parse(readFileSync(new URL('../evaluations/fixtures/discovery-v1.json', import.meta.url),'utf8')) as {
  cases:Array<{split:string;query:string;expected:string|null}>};
for(const probe of fixture.cases.filter(item=>item.split==='development'))it(`discovers real capability: ${probe.query}`,()=>{
  const names = discoverToolSchemas(catalog,probe.query,3).map(tool=>tool.name);
  assert.ok(names.includes(probe.expected!));
});
it('matches whole words, ranks exact names first and never retrieves omitted tools',()=>{
  const tools=[{name:'focus',description:'Keep attention',inputSchema:{}},
    {name:'search_memory',description:'Recall saved decisions',inputSchema:{}}];
  assert.deepEqual(discoverToolSchemas(tools,'us'),[]);
  assert.equal(discoverToolSchemas(tools,'ＳＥＡＲＣＨ＿ＭＥＭＯＲＹ')[0]?.name,'search_memory');
  assert.deepEqual(discoverToolSchemas(tools.slice(0,1),'memory'),[]);
  assert.deepEqual(discoverToolSchemas(tools,'!!!'),[]);
});
