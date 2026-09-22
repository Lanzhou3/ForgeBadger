import assert from 'node:assert/strict';
import { it } from 'node:test';
import { z } from 'zod';
import { createAgentToolRegistry, zodToJsonSchema } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
it('preserves actual tool constraints and default optionality', () => {
  const schemas = createAgentToolRegistry(createPlatformTools()).toModelSchemas();
  const session = schemas.find(t => t.name === 'get_session_output')!.inputSchema;
  assert.deepEqual((session.properties as Record<string,unknown>).maxLines, {type:'integer',minimum:1,maximum:500});
  const memory = schemas.find(t => t.name === 'search_memory')!.inputSchema;
  assert.ok(!(memory.required as string[]).includes('scope'));
  assert.deepEqual((memory.properties as Record<string,unknown>).scope, {type:'string',enum:['global','project','session'],default:'global'});
});
it('preserves strict objects, string/array bounds, nullable and descriptions', () => {
  const schema = zodToJsonSchema(z.object({value:z.string().min(2).max(8).describe('name').nullable(),items:z.array(z.number().int()).min(1).max(3)}).strict());
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual((schema.properties as Record<string,unknown>).value, {anyOf:[{type:'string',minLength:2,maxLength:8,description:'name'},{type:'null'}],description:'name'});
  assert.deepEqual((schema.properties as Record<string,unknown>).items,{type:'array',items:{type:'integer'},minItems:1,maxItems:3});
});
it('fails explicitly for unsupported executable transformations', () => {
  assert.throws(() => zodToJsonSchema(z.string().transform(s=>s.length)), /Unsupported/);
});
