import assert from 'node:assert/strict';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AgentLlmRequest } from '../src/services/agent/llm-client.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SessionServer } from '../src/services/session-server/session-server.js';
import { IpcServer } from '../src/services/session-server/ipc-server.js';
import { SessionServerClient } from '../src/services/session-server-client.js';
import { InMemorySessionManager } from '../src/services/session-manager.js';
import { UserRepository } from '../src/db/repositories/user-repository.js';
import { ProjectRepository } from '../src/db/repositories/project-repository.js';
import { SessionRepository } from '../src/db/repositories/session-repository.js';
import { createAgentToolRegistry } from '../src/services/agent/tool-registry.js';
import { createPlatformTools } from '../src/services/agent/tools/index.js';
import { createCopilotOrchestrator } from '../src/services/agent/orchestrator.js';
import { CopilotRunLedger } from '../src/services/agent/run-ledger.js';
import { ForgeBadgerEventBus } from '../src/services/event-bus.js';
import { publishCompletion } from '../src/services/agent/llm-response.js';
it('run cancellation stops a real Shell before later file effects', {skip: process.platform === 'win32', timeout: 15_000}, async () => {
  const root = mkdtempSync('/private/tmp/fb-overall-shell-');
  const db = new Database(':memory:');
  migrate(drizzle(db),{migrationsFolder:fileURLToPath(new URL('../src/db/migrations', import.meta.url))});
  const server = new SessionServer();
  const token = randomUUID();
  const ipc = new IpcServer({ipcPath:join(root,'ipc.sock'),sessionServer:server,token});
  const client = new SessionServerClient({ipcPath:join(root,'ipc.sock'),token});
  try {
    await ipc.start(); await client.connect();
    const manager = new InMemorySessionManager(client,undefined,undefined,{db});
    const user = new UserRepository(db).create('overall-shell-probe@test.dev','fixture');
    const projects = new ProjectRepository(db,user.id);
    const project = projects.create({name:'Probe',path:root,aiTool:'pi'});
    projects.setCopilotAutonomy(project.id,true);
    const ledger = new CopilotRunLedger(db,user.id);
    const conversation = ledger.log.createConversation('cancel probe');
    let calls = 0;
    const llm = {async stream(request: AgentLlmRequest){return publishCompletion({message:calls++===0?'':'fixture complete',thinking:'',toolCalls:calls===1?[{id:'shell-probe',name:'terminal_run',arguments:JSON.stringify({projectId:project.id,command:'printf "PROBE_STARTED\\n"; sleep 3; printf done > cancelled-command-proof.txt',timeoutMs:5000})}]:[],finishReason:calls===1?'tool_calls':'stop'},request.onEvent,request.signal??new AbortController().signal,false);},async summarize(){return '';},async generateTitle(){return '';}};
    const orchestrator = createCopilotOrchestrator({db,masterKey:'abcdef0123456789abcdef0123456789',llm,toolRegistry:createAgentToolRegistry(createPlatformTools()),eventBus:new ForgeBadgerEventBus(),sessionManager:manager});
    const runId = await orchestrator.runTurn({userId:user.id,conversationId:conversation.id,userText:'Run this authorized temporary command',projectId:project.id});
    assert.equal(ledger.get(runId)?.status,'awaiting_approval');
    const action = ledger.log.listPendingActions(runId)[0]!;
    const executing = orchestrator.resumeAfterApproval({userId:user.id,runId,actionId:action.id,approved:true,decisionOrigin:'web'});
    let submitted = false;
    for (let i=0;i<100&&!submitted;i++) {
      const session = new SessionRepository(db,user.id).listByProject(project.id)[0];
      if(session&&manager.getSession(session.id)) {
        const pane = await manager.captureHistory(session.id);
        submitted = pane.includes('PROBE_STARTED');
      }
      if(!submitted) await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.ok(submitted,'must observe real command submission before cancellation');
    assert.equal(existsSync(join(root,'cancelled-command-proof.txt')),false);
    assert.equal((await orchestrator.cancelRun({userId:user.id,runId})).cancelled,true);
    assert.equal(ledger.get(runId)?.status,'cancelled');
    await executing;
    await new Promise(resolve => setTimeout(resolve, 3500));
    assert.equal(new SessionRepository(db,user.id).listByProject(project.id).length, 0);
    const sideEffectAfterCancellation = existsSync(join(root,'cancelled-command-proof.txt'));
    assert.equal(sideEffectAfterCancellation,false);
  } finally {
    await client.disconnect(); await ipc.stop(); await server.destroy(); db.close(); rmSync(root,{recursive:true,force:true});
  }
});
