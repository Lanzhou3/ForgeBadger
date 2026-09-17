import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { CopilotConversationLog } from "../src/services/agent/conversation-log.js";
import { CopilotRunLedger } from "../src/services/agent/run-ledger.js";

it("migration preserves legacy evidence but expires all non-resumable runs and actions",()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"copilot-legacy-migration-"));
  const db=new Database(":memory:");
  const root=new URL("../src/db/migrations/",import.meta.url).pathname;
  try {
    mkdirSync(path.join(dir,"meta"));
    const journal=JSON.parse(readFileSync(path.join(root,"meta/_journal.json"),"utf8")) as {entries:{tag:string}[]};
    journal.entries=journal.entries.filter(e=>Number(e.tag.slice(0,4)) < 68);
    writeFileSync(path.join(dir,"meta/_journal.json"),JSON.stringify(journal));
    for(const e of journal.entries)copyFileSync(path.join(root,e.tag+".sql"),path.join(dir,e.tag+".sql"));
    migrate(drizzle(db),{migrationsFolder:dir});
    const user=new UserRepository(db).create("migration-fixture@example.com","hash");
    const log=new CopilotConversationLog(db,user.id);const c=log.createConversation();
    const run=log.createRun(c.id,{});log.updateRun(run.id,{status:"awaiting_approval"});
    const a=log.createPendingAction({runId:run.id,tool:"create_project",inputJson:"{}",inputDigest:"historical"});
    const m=log.appendMessage(c.id,{role:"assistant",kind:"text",content:"historical evidence"});
    migrate(drizzle(db),{migrationsFolder:root});
    assert.equal(log.getRun(run.id)?.status,"failed");
    assert.equal(log.getRun(run.id)?.stopReason,"legacy_runtime_not_resumable");
    assert.equal(log.getPendingAction(a.id)?.status,"expired");
    assert.equal(log.listMessages(c.id)[0]?.id,m.id);
    assert.equal(new CopilotRunLedger(db,user.id).claim(run.id,"new-runtime",30000),undefined);
    assert.deepEqual(db.pragma("foreign_key_check"),[]);
    migrate(drizzle(db),{migrationsFolder:root});
    assert.equal(log.listRuns(c.id).length,1);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});
