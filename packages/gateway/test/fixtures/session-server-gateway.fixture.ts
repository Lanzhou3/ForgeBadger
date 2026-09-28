import { once } from 'node:events';
import { createGatewayRuntime } from '../../src/runtime/start-gateway.js';
import { signJwt } from '../../src/auth/jwt.js';
// node:test also discovers support scripts beneath test/. Never start a real
// Gateway unless the parent lifecycle test supplied its isolated state directory.
const root = process.env.FB_TEST_STATE;
if (!root) process.exit(0);
const secret = 'gateway-lifecycle-test-secret-12345678';
const runtime = await createGatewayRuntime({
  FORGEBADGER_STATE_DIR: root, FORGEBADGER_DB_PATH: `${root}/db.sqlite`,
  FORGEBADGER_MASTER_KEY: 'a'.repeat(64), FORGEBADGER_JWT_SECRET: secret
});
const db = runtime.app.locals.db;
if (process.env.FB_TEST_CREATE === '1') {
  db.prepare("INSERT INTO users(id,username,email,password_hash,role,status) VALUES ('u1','u1','u1@example.test','x','admin','active')").run();
  db.prepare("INSERT INTO projects(id,user_id,name,path,ai_tool,status) VALUES ('p1','u1','test',?,'codex','active')").run(root);
  db.prepare("INSERT INTO sessions(id,user_id,project_id,name,ai_tool,status,working_dir,credential_mode,attach_token) VALUES ('s1','u1','p1','test','codex','idle',?,'host_environment','attach-test')").run(root);
  await runtime.sessionManager.createSession({ userId:'u1',sessionId:'s1',attachToken:'attach-test', launchPlan:{command:process.execPath,args:['-e', 'console.log("PTY_PID="+process.pid); process.stdin.on("data",d=>process.stdout.write(String(d).includes("flood") ? "x".repeat(2*1024*1024)+"FLOOD_END\\n" : "ECHO:"+d));'],cwd:root,env:{},secretEnvNames:[],credentialMode:'host_environment'} });
}
runtime.server.listen(0,'127.0.0.1');
await once(runtime.server,'listening');
console.log('FIXTURE_READY='+JSON.stringify({port:(runtime.server.address() as {port:number}).port, token:signJwt({userId:'u1',email:'u1@example.test'},secret), status:db.prepare("SELECT status FROM sessions WHERE id='s1'").get().status}));
process.on('SIGTERM',()=>void runtime.close().then(()=>process.exit(0)));
