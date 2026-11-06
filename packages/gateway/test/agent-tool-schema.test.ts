import assert from 'node:assert/strict';
import { it } from 'node:test';
import { z } from 'zod';
import { createAgentToolRegistry, modelObjectSchema, zodToJsonSchema } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { computeToolSurface } from '../src/services/agent/tool-surface.js';
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
it('declares a top-level object type for every model tool schema, including union inputs', () => {
  // Provider tool-calling contracts (Anthropic input_schema, OpenAI
  // parameters) reject a whole request when any inputSchema lacks the
  // top-level type: "object"; pm_manage_stage is a top-level zod union.
  const schemas = createAgentToolRegistry(createPlatformTools()).toModelSchemas();
  assert.ok(schemas.length > 0);
  for (const tool of schemas) assert.equal(tool.inputSchema.type, 'object', tool.name);
  const stage = schemas.find(t => t.name === 'pm_manage_stage')!.inputSchema;
  assert.ok(Array.isArray(stage.anyOf), 'pm_manage_stage keeps its anyOf branches');
  for (const branch of stage.anyOf as Array<Record<string, unknown>>) assert.equal(branch.type, 'object');
});
it('keeps the union-shaped stage tool object-typed on the goal model surface', () => {
  // Goal runs are where the board-planning tools (and pm_manage_stage) are
  // sent to the model; the surface projection must not regress the shape.
  const registry = createAgentToolRegistry(createPlatformTools());
  const { visible } = computeToolSurface({ source: 'user', goalId: 'goal-1' }, { registry, hasSessionManager: true });
  const stage = visible.find(t => t.name === 'pm_manage_stage');
  assert.ok(stage, 'pm_manage_stage is visible to goal runs');
  assert.equal(stage!.inputSchema.type, 'object');
  for (const tool of visible) assert.equal(tool.inputSchema.type, 'object', tool.name);
});
it('modelObjectSchema only adds the missing top-level type', () => {
  assert.deepEqual(modelObjectSchema({ anyOf: [{ type: 'object' }] }), { type: 'object', anyOf: [{ type: 'object' }] });
  const unchanged = { type: 'object', properties: {} };
  assert.equal(modelObjectSchema(unchanged), unchanged);
});
