import { UserRepository } from '../../../db/repositories/user-repository.js';
import type { Database } from '../../../db/types.js';
import type { CopilotSkillFile, CopilotSkillSource } from '../../../db/repositories/copilot-skill-revision-repository.js';
import { publicFetch } from '../../extensions/public-fetch.js';
import { CopilotSkillService, type CopilotSkillQueryOptions } from './copilot-skill-service.js';
import { MAX_COPILOT_SKILL_FILE_BYTES } from './copilot-skill-package.js';

export type CopilotSkillImportInput = {source:CopilotSkillSource;files:CopilotSkillFile[]} | {source:{kind:'url';url:string}};
/** Raw URL import copies one SKILL.md only; it never crawls URLs or executes remote resources. */
export async function importCopilotSkill(db: Database, userId: string, input: CopilotSkillImportInput, options: CopilotSkillQueryOptions = {}, fetchSource: typeof publicFetch = publicFetch) {
  const assertActive = () => { if (new UserRepository(db).findById(userId)?.status !== 'active') throw new Error('Skill owner is inactive'); };
  assertActive();
  let files: CopilotSkillFile[];
  if ('files' in input) files = input.files;
  else {
    const response = await fetchSource(input.source.url, {method:'GET'}, assertActive);
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Skill source returned HTTP ${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Skill source returned no content');
    const chunks: Uint8Array[] = []; let total=0;
    try {
      for (;;) {
        const {done,value} = await reader.read(); if(done)break;
        total+=value.byteLength;
        if(total>MAX_COPILOT_SKILL_FILE_BYTES)throw new Error('Skill source exceeds file size limit');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(()=>undefined); }
    const content = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    files = [{path:'SKILL.md',content}];
  }
  assertActive();
  return new CopilotSkillService(db,userId).importFiles(input.source,files,options);
}
