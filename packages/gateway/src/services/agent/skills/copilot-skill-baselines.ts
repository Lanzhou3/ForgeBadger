import { createHash } from 'node:crypto';
import type { CopilotSkillSnapshot } from '../../../db/repositories/copilot-skill-revision-repository.js';
import { LEGACY_COPILOT_SKILLS } from './legacy-copilot-skills.js';
import { packageMainFile } from './copilot-skill-package.js';

// Immutable fingerprints recovered from repository releases. Preserve old entries when
// bundling a new version; never infer an unmodified package from its version alone.
const baselines = [
  {"name":"autonomous-work-item-loop","version":"4.0.0","digest":"8d1b9f3513c668391bcb24674529e4c87639df87c55a1e444243e1dd94ae93ba","commit":"3ad0b952"},
  {"name":"session-dispatch","version":"4.0.0","digest":"3e7ca40f0b096bc8b89aa275e4300b5c5b615bb7c5d41db76f149d632d555ff0","commit":"3ad0b952"},
  {"name":"project-insights","version":"2.0.0","digest":"083d7993cec74c9fe580364fcbda8ad9112983e633ffb626045c855447dd95a3","commit":"3ad0b952"},
  {"name":"memory-playbook","version":"3.0.0","digest":"475ad6984a94e24df0ded7da849f706f4e38a792f7a97d9dd4973279424fa1c5","commit":"3ad0b952"},
  {"name":"usage-analysis","version":"2.0.0","digest":"aba6e4d8b2eda084ed9e06f48c9e79fee373122615f7a78d86bea31ae17f2c73","commit":"3ad0b952"},
  {"name":"safety-and-approvals","version":"3.0.0","digest":"d33da5a22d9f94ef873a8cb9b608ab9e014946c0a4540d35dde704d58eb47094","commit":"3ad0b952"},
  {"name":"autonomous-work-item-loop","version":"3.0.0","digest":"55d825b6e9254cc062150abd5c8265cd4b6ca120db11897c0de615010ea8fdc4","commit":"bb217ddf"},
  {"name":"session-dispatch","version":"3.0.0","digest":"f61b19f7bb7b223c1ad2ae72f6eae18e3e5eb375bf578435cb3a988377002c37","commit":"bb217ddf"},
  {"name":"memory-playbook","version":"2.0.0","digest":"a4167b12369cd20426323dd60b4a393bb2085f9dc20b65dbd4a172be0a63b77a","commit":"bb217ddf"},
  {"name":"safety-and-approvals","version":"2.0.0","digest":"29e1f0f8fccc1cc93f2b815211eb383d3c70702003282807c1ea7ed9c9c4dc3f","commit":"bb217ddf"},
  {"name":"autonomous-work-item-loop","version":"3.0.0","digest":"9926722c0c80aabd4c8b832736d78da38921c1f6fb8116af993511180651cbe3","commit":"bf75af23"},
  {"name":"session-dispatch","version":"3.0.0","digest":"9c9b5ca853848a49af66fbd29d2ecad3bfb0560ee8850dc541fa070b0911ca08","commit":"bf75af23"},
  {"name":"safety-and-approvals","version":"2.0.0","digest":"2da6d6c16bf3bfc99439a3dd35d4b1828036f132efaa25d61b7983e0bb1035a8","commit":"bf75af23"},
  {"name":"autonomous-work-item-loop","version":"2.0.0","digest":"564a9f1d783c4365b5350e06fb5c8db8b8caf5030ba2e1e990eda5367948b51e","commit":"c9468cbf"},
  {"name":"session-dispatch","version":"2.0.0","digest":"534dfd1dbdc5fa0afd6076f1a8c133e2745984dfdb9bd4b4ba184f34f840bba2","commit":"c9468cbf"},
  {"name":"safety-and-approvals","version":"2.0.0","digest":"fae0815d5a8b794fd1f51875dcced3a99ced5b5c92cf6fef789e7cf597dd3feb","commit":"c9468cbf"},
  {"name":"autonomous-work-item-loop","version":"4.0.1","digest":"e6362fe352f2f1f5a9a07887e44e44f37f88b68cbe673b9e987af76c74bf7295","commit":"bundled-2026-09-26"},
  {"name":"session-dispatch","version":"4.0.1","digest":"79ebeef444c9cf99eb935fe98dfcc2b0c9690ab65bc3ce8f3ba22f0661af004a","commit":"bundled-2026-09-26"},
  {"name":"project-insights","version":"2.0.1","digest":"977afe76519be491a6e52aa22ff2725047872db0b7c0a3e8d5aa2967e3c177fa","commit":"bundled-2026-09-26"},
  {"name":"memory-playbook","version":"3.0.1","digest":"de7008ddfa3b4e53bcf238ee5e4395c2b702b18d43aa20686d95f04a1cf5ef1d","commit":"bundled-2026-09-26"},
  {"name":"safety-and-approvals","version":"3.0.1","digest":"2aa044b5e4731b58bee10c166fbc31538fcf81d7461c126007f47ec9d49df0ee","commit":"bundled-2026-09-26"},
] as const;

export function isUnmodifiedBuiltin(snapshot: CopilotSkillSnapshot): boolean {
  if (snapshot.files.length !== 1 || snapshot.incompatibilityReasons.length) return false;
  const expected = packageMainFile(snapshot.name, snapshot.description, snapshot.version, snapshot.content);
  if (snapshot.files[0]?.path !== expected.path || snapshot.files[0]?.content !== expected.content) return false;
  const legacy = LEGACY_COPILOT_SKILLS.find(skill => skill.name === snapshot.name);
  if (snapshot.version === '1.0.0' && legacy?.description === snapshot.description && legacy.body === snapshot.content) return true;
  const digest = createHash('sha256').update(JSON.stringify([snapshot.name, snapshot.description, snapshot.content])).digest('hex');
  return baselines.some(item => item.name === snapshot.name && item.version === snapshot.version && item.digest === digest);
}
