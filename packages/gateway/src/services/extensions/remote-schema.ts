import { Ajv } from 'ajv';
import { z } from 'zod';
const compiled = new Map<string, z.ZodType<unknown>>();
const allowed = new Set(['type','properties','required','additionalProperties','items','enum','const','anyOf','oneOf','allOf','not','description','title','default','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','minItems','maxItems','uniqueItems','minProperties','maxProperties']);
/** Small portable JSON Schema subset. No refs, regex, formats, schema-triggered I/O or mutation. */
export function remoteInputSchema(schema: Record<string, unknown>): z.ZodType<unknown> {
  const key = JSON.stringify(schema);
  if (key.length > 16_384 || schema.type !== 'object') throw new Error('Unsupported tool schema');
  const cached = compiled.get(key);
  if (cached) return cached;
  let count = 0;
  function inspect(node: unknown, depth: number): void {
    if (++count > 512 || depth > 10 || !node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Unsupported tool schema');
    for (const [key, value] of Object.entries(node)) {
      if (!allowed.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
      if (key === 'properties') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid properties');
        for (const [name, child] of Object.entries(value)) {
          if (['__proto__','constructor','prototype'].includes(name)) throw new Error('Unsupported property');
          inspect(child, depth + 1);
        }
      } else if (['items','not'].includes(key) || (key === 'additionalProperties' && typeof value === 'object')) inspect(value, depth + 1);
      else if (['allOf','anyOf','oneOf'].includes(key)) {
        if (!Array.isArray(value) || value.length > 10) throw new Error('Unsupported schema union');
        value.forEach(child => inspect(child, depth + 1));
      }
    }
  }
  inspect(schema, 0);
  const ajv = new Ajv({ strict: true, allErrors: false, validateFormats: false, addUsedSchema: false, ownProperties: true });
  const validate = ajv.compile(schema);
  const result = z.unknown().superRefine((value, ctx) => {
    if (JSON.stringify(value ?? null).length > 32_768 || !validate(value)) ctx.addIssue({ code: 'custom', message: 'Input does not match the connection tool schema' });
  });
  if (compiled.size >= 64) compiled.delete(compiled.keys().next().value!);
  compiled.set(key, result);
  return result;
}

