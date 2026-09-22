import { z } from 'zod';
type Schema = Record<string, unknown>;
/** Input-side Zod 3 contract. Runtime refinements remain authoritative. */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Schema {
  const result = convert(schema);
  return schema.description ? { ...result, description: schema.description } : result;
}
function convert(schema: z.ZodType<unknown>): Schema {
  if (schema instanceof z.ZodString) return stringSchema(schema);
  if (schema instanceof z.ZodNumber) return numberSchema(schema);
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { const: schema.value, type: schema.value === null ? 'null' : typeof schema.value };
  if (schema instanceof z.ZodNull) return { type: 'null' };
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) return {};
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { anyOf: [zodToJsonSchema(schema.unwrap()), {type:'null'}] };
  if (schema instanceof z.ZodDefault) return { ...zodToJsonSchema(schema.removeDefault()), default: schema._def.defaultValue() };
  if (schema instanceof z.ZodUnion) return { anyOf: (schema.options as z.ZodType<unknown>[]).map(zodToJsonSchema) };
  if (schema instanceof z.ZodRecord) return { type:'object', additionalProperties: zodToJsonSchema(schema.valueSchema) };
  if (schema instanceof z.ZodArray) return {type:'array',items:zodToJsonSchema(schema.element),
    ...(schema._def.minLength ? {minItems:schema._def.minLength.value}:{}),
    ...(schema._def.maxLength ? {maxItems:schema._def.maxLength.value}:{}),
    ...(schema._def.exactLength ? {minItems:schema._def.exactLength.value,maxItems:schema._def.exactLength.value}:{})};
  if (schema instanceof z.ZodObject) return objectSchema(schema);
  if (schema instanceof z.ZodEffects && schema._def.effect.type === 'refinement') return zodToJsonSchema(schema.innerType());
  throw new Error(`Unsupported model tool schema: ${schema.constructor.name}`);
}
function objectSchema(schema: z.AnyZodObject): Schema {
  const shape = schema.shape as Record<string,z.ZodType<unknown>>;
  const required = Object.entries(shape).filter(([,value])=>!value.isOptional()).map(([key])=>key);
  return {type:'object',properties:Object.fromEntries(Object.entries(shape).map(([key,value])=>[key,zodToJsonSchema(value)])),
    ...(required.length ? {required}:{}),
    additionalProperties: schema._def.catchall instanceof z.ZodNever
      ? schema._def.unknownKeys !== 'strict' : zodToJsonSchema(schema._def.catchall)};
}
function numberSchema(schema: z.ZodNumber): Schema {
  const result: Schema = {type:schema.isInt?'integer':'number'};
  for (const check of schema._def.checks) {
    if (check.kind === 'min') result[check.inclusive?'minimum':'exclusiveMinimum'] = check.value;
    if (check.kind === 'max') result[check.inclusive?'maximum':'exclusiveMaximum'] = check.value;
    if (check.kind === 'multipleOf') result.multipleOf = check.value;
  }
  return result;
}
function stringSchema(schema: z.ZodString): Schema {
  const result: Schema = {type:'string'};
  for (const check of schema._def.checks) {
    if (check.kind === 'min') result.minLength = check.value;
    else if (check.kind === 'max') result.maxLength = check.value;
    else if (check.kind === 'length') { result.minLength=check.value; result.maxLength=check.value; }
    else if (check.kind === 'regex') { if(check.regex.flags) throw new Error('Unsupported model tool regex flags'); result.pattern=check.regex.source; }
    else if (['uuid','email','url','datetime'].includes(check.kind)) result.format = check.kind === 'url'?'uri':check.kind==='datetime'?'date-time':check.kind;
    else if (!['trim','toLowerCase','toUpperCase'].includes(check.kind)) throw new Error(`Unsupported model tool string check: ${check.kind}`);
  }
  return result;
}
