import { PROTOCOL_VERSION } from "../src/services/session-server/ipc-protocol.js";
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { createPlatformAdapter } from '../src/services/session-server/platform-adapter.js';
import { IpcServer } from '../src/services/session-server/ipc-server.js';
import { SessionServer } from '../src/services/session-server/session-server.js';
import { SessionServerClient } from '../src/services/session-server-client.js';

const token = 'a'.repeat(64);
it('Windows endpoint isolates state directories and remains stable', () => {
  const adapter = createPlatformAdapter('win32');
  assert.equal(adapter.getIpcPath('C:\\state-a'), createPlatformAdapter('win32').getIpcPath('C:\\state-a'));
  assert.notEqual(adapter.getIpcPath('C:\\state-a'), adapter.getIpcPath('C:\\state-b'));
});
it('another IPC server cannot replace a live endpoint', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-safe-'));
  const path = join(dir, 'ipc.sock');
  const a = new IpcServer({ ipcPath: path, token, sessionServer: new SessionServer() });
  const b = new IpcServer({ ipcPath: path, token, sessionServer: new SessionServer() });
  try {
    await a.start();
    await assert.rejects(b.start(), /live|in use|EADDRINUSE/i);
  } finally { await b.stop(); await a.stop(); rmSync(dir, { recursive: true, force: true }); }
});
it('closing a displaced server preserves the replacement endpoint', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-safe-'));
  const path = join(dir, 'ipc.sock');
  const a = new IpcServer({ ipcPath: path, token, sessionServer: new SessionServer() });
  const b = new IpcServer({ ipcPath: path, token, sessionServer: new SessionServer() });
  const client = new SessionServerClient({ ipcPath: path, token });
  try {
    await a.start(); unlinkSync(path); await b.start(); await a.stop();
    await client.connect();
    assert.deepEqual(await client.listSessions(), []);
  } finally { await client.disconnect(); await b.stop(); await a.stop(); rmSync(dir, { recursive: true, force: true }); }
});
it('rejects null and fractional-version hello without killing the server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-safe-'));
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\fb-safe-${process.pid}` : join(dir, 'ipc.sock');
  const server = new IpcServer({ ipcPath: path, token, sessionServer: new SessionServer() });
  try {
    await server.start();
    for (const message of [null, 1, [], { type: 'hello', token, protocolVersion: 1.5 }, { type: 'hello', protocolVersion: { toString: null } }, { type: 'hello', protocolVersion: [{ toString: null }] }]) {
      const socket = new Socket();
      const result = new Promise<string>(resolve => {
        let output = ''; socket.setEncoding('utf8'); socket.on('data', data => { output += data; });
        socket.on('close', () => resolve(output)); socket.on('error', () => {});
      });
      socket.connect(path, () => socket.write(JSON.stringify(message) + '\n'));
      assert.match(await result, /hello_error/);
    }
  } finally { await server.stop(); rmSync(dir, { recursive: true, force: true }); }
});

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startAndConnectSessionServer } from '../src/services/session-server-integration.js';
import { resolveSessionServerTokenPath, writeSessionServerTokenFile } from '../src/services/session-server/auth-token.js';

function childGateway(stateDir: string, create: boolean): Promise<{ pid: number; reused: boolean; sessions: string[] }> {
  const integrationUrl = new URL('../src/services/session-server-integration.ts', import.meta.url).href;
  const script = `import { startAndConnectSessionServer } from ${JSON.stringify(integrationUrl)};
    const integration = await startAndConnectSessionServer({ stateDir: ${JSON.stringify(stateDir)} });
    try {
      if (${create}) await integration.client.createSession({name:'fb-test-persist',cwd:${JSON.stringify(stateDir)},command:process.execPath,args:['-e','setInterval(()=>{},1000)'],env:{}});
      console.log('RESULT:'+JSON.stringify({pid:integration.serverPid,reused:integration.reused,sessions:await integration.client.listSessions()}));
    } finally { await integration.disconnect(); }`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = ''; let error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`Gateway child failed: ${error}`));
      const line = output.split('\n').find(line => line.startsWith('RESULT:'));
      if (!line) return reject(new Error(`Gateway child omitted result: ${output}`));
      resolve(JSON.parse(line.slice(7)));
    });
  });
}
it('real independent Gateway processes reuse a daemon and session at the default endpoint', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-persist-'));
  try {
    const first = await childGateway(dir, true);
    const second = await childGateway(dir, false);
    assert.equal(first.reused, false); assert.equal(second.reused, true);
    assert.equal(first.pid, second.pid); assert.deepEqual(second.sessions, ['fb-test-persist']);
  } finally {
    const integration = await startAndConnectSessionServer({ stateDir: dir });
    await integration.stop(); rmSync(dir, { recursive: true, force: true });
  }
});
it('concurrent Gateway processes elect a single daemon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-elect-'));
  try {
    const results = await Promise.all([childGateway(dir, false), childGateway(dir, false), childGateway(dir, false)]);
    assert.equal(new Set(results.map(result => result.pid)).size, 1);
    assert.equal(results.filter(result => !result.reused).length, 1);
  } finally {
    const integration = await startAndConnectSessionServer({ stateDir: dir });
    await integration.stop(); rmSync(dir, { recursive: true, force: true });
  }
});
it('authentication failure preserves a live endpoint and its token file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-auth-'));
  const ipcPath = createPlatformAdapter().getIpcPath(dir);
  const server = new IpcServer({ ipcPath, token, sessionServer: new SessionServer() });
  const tokenPath = resolveSessionServerTokenPath(dir);
  const wrongToken = 'b'.repeat(64);
  writeSessionServerTokenFile(tokenPath, wrongToken);
  try {
    await server.start();
    await assert.rejects(startAndConnectSessionServer({ stateDir: dir }), /hello rejected/);
    assert.equal(readFileSync(tokenPath, 'utf8'), wrongToken);
    const client = new SessionServerClient({ ipcPath, token });
    try { await client.connect(); assert.deepEqual(await client.listSessions(), []); }
    finally { await client.disconnect(); }
  } finally { await server.stop(); rmSync(dir, { recursive: true, force: true }); }
});

import { createServer } from 'node:net';
import { performClientHello } from '../src/services/session-server/hello-handshake.js';
import { withDaemonStartupLock } from '../src/services/session-server/endpoint-lifecycle.js';

it('client hello rejects malformed identities and protocol versions', async () => {
  for (const reply of [null, [], { type:'hello_ok', protocolVersion:PROTOCOL_VERSION + 1, pid:1, startedAt:new Date().toISOString() }, { type:'hello_ok', protocolVersion:1 }, { type: { toString: null } }, { type: 'hello_error', message: { toString: null }, protocolVersion: 1 }, { type: 'hello_error', message: 'rejected', protocolVersion: { toString: null } }]) {
    const server = createServer(socket => {
      socket.on('error', () => {});
      socket.once('data', () => socket.write(JSON.stringify(reply) + '\n'));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const socket = new Socket();
    try {
      await new Promise<void>(resolve => socket.connect(address.port, '127.0.0.1', resolve));
      await assert.rejects(performClientHello(socket, token, 500), /Invalid|Incompatible/);
    } finally { socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
it('concurrent client connects share one authenticated socket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-client-'));
  const ipcPath = createPlatformAdapter().getIpcPath(dir);
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    connections++; sockets.add(socket); socket.setEncoding('utf8'); let buffer='';
    socket.on('data', data => {
      buffer += data; let newline;
      while ((newline=buffer.indexOf('\n')) !== -1) {
        const message=JSON.parse(buffer.slice(0,newline)); buffer=buffer.slice(newline+1);
        socket.write(JSON.stringify(message.type === 'hello'
          ? {type:'hello_ok',protocolVersion:PROTOCOL_VERSION,pid:process.pid,startedAt:new Date().toISOString()}
          : {type:'ok',id:message.id,data:[]})+'\n');
      }
    });
    socket.on('error',()=>{}); socket.on('close',()=>sockets.delete(socket));
  });
  const client = new SessionServerClient({ ipcPath, token });
  try {
    await new Promise<void>(resolve => server.listen(ipcPath,resolve));
    await Promise.all(Array.from({length:12},()=>client.connect()));
    assert.equal(connections,1);
    await client.disconnect();
    await client.connect();
    assert.deepEqual(await client.listSessions(),[]);
    assert.equal(client.isAvailable(),true);
  } finally {
    await client.disconnect(); for(const socket of sockets) socket.destroy();
    await new Promise<void>(resolve=>server.close(()=>resolve())); rmSync(dir,{recursive:true,force:true});
  }
});
it('startup lock serializes contenders and releases on failure', async () => {
  const dir=mkdtempSync(join(tmpdir(),'fb-lock-')); const path=join(dir,'startup.lock');
  let active=0; let maximum=0;
  try {
    await Promise.all(Array.from({length:4},()=>withDaemonStartupLock(path,async()=>{
      active++; maximum=Math.max(maximum,active);
      await new Promise(resolve=>setTimeout(resolve,20)); active--;
    })));
    assert.equal(maximum,1);
    await assert.rejects(withDaemonStartupLock(path,async()=>{throw new Error('failure');}), /failure/);
    assert.equal(await withDaemonStartupLock(path,async()=>42),42);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

it('missing token, protocol rejection and hello timeout never replace a live daemon', async () => {
  for (const failure of ['missing-token', 'protocol', 'timeout'] as const) {
    const dir=mkdtempSync(join(tmpdir(),'fb-probe-'));
    const ipcPath=createPlatformAdapter().getIpcPath(dir);
    const tokenPath=resolveSessionServerTokenPath(dir);
    if(failure !== 'missing-token') writeSessionServerTokenFile(tokenPath,token);
    const sockets=new Set<Socket>();
    const server=createServer(socket=>{
      sockets.add(socket); socket.on('close',()=>sockets.delete(socket)); socket.on('error',()=>{});
      socket.on('data',()=>{
        if(failure==='protocol') socket.write(JSON.stringify({type:'hello_ok',protocolVersion:PROTOCOL_VERSION + 1,pid:process.pid,startedAt:new Date().toISOString()})+'\n');
      });
    });
    try {
      await new Promise<void>(resolve=>server.listen(ipcPath,resolve));
      await assert.rejects(startAndConnectSessionServer({stateDir:dir}), /ENOENT|protocol version|timed out/);
      assert.equal(server.listening,true);
      if(failure==='missing-token') assert.throws(()=>readFileSync(tokenPath), /ENOENT/);
      else assert.equal(readFileSync(tokenPath,'utf8'),token);
    } finally {
      for(const socket of sockets) socket.destroy();
      await new Promise<void>(resolve=>server.close(()=>resolve())); rmSync(dir,{recursive:true,force:true});
    }
  }
});
it('malformed authenticated requests are correlated and leave the daemon usable', async () => {
  const dir=mkdtempSync(join(tmpdir(),'fb-schema-'));
  const ipcPath=createPlatformAdapter().getIpcPath(dir);
  const server=new IpcServer({ipcPath,token,sessionServer:new SessionServer()});
  const socket=new Socket();
  try {
    await server.start(); await new Promise<void>(resolve=>socket.connect(ipcPath,resolve));
    await performClientHello(socket,token,500);
    for(const request of [null,{type:'create_session',id:'bad',launchPlan:null},{type:'resize_window',id:'bad',sessionId:'x',cols:-1,rows:10}]) {
      const response=new Promise<string>(resolve=>socket.once('data',chunk=>resolve(String(chunk))));
      socket.write(JSON.stringify(request)+'\n');
      const message=JSON.parse(await response);
      assert.equal(message.type,'error'); assert.equal(message.id,request ? 'bad' : '');
    }
    const response=new Promise<string>(resolve=>socket.once('data',chunk=>resolve(String(chunk))));
    socket.write(JSON.stringify({type:'list_sessions',id:'good'})+'\n');
    assert.deepEqual(JSON.parse(await response),{id:'good',type:'ok',data:[]});
  } finally {socket.destroy();await server.stop();rmSync(dir,{recursive:true,force:true});}
});

import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';
it('deep state directories use a short private endpoint across independent Gateways', { skip: process.platform === 'win32' }, async () => {
  const root=mkdtempSync(join(tmpdir(),'fb-deep-'));
  const dir=join(root,'long-state-directory-'.repeat(8));
  mkdirSync(dir);
  let ipcPath: string | undefined;
  try {
    ipcPath=createPlatformAdapter().getIpcPath(dir);
    assert.ok(Buffer.byteLength(ipcPath) <= 100, `socket path is too long: ${ipcPath}`);
    const first=await childGateway(dir,true);
    const second=await childGateway(dir,false);
    assert.equal(second.reused,true); assert.equal(first.pid,second.pid);
    assert.deepEqual(second.sessions,['fb-test-persist']);
  } finally {
    if(ipcPath && Buffer.byteLength(ipcPath)<=100) {
      const integration=await startAndConnectSessionServer({stateDir:dir});
      await integration.stop();
      const deadline=Date.now()+3000;
      while(existsSync(ipcPath) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
      if(!ipcPath.startsWith(root+'/')) rmdirSync(dirname(ipcPath));
    }
    rmSync(root,{recursive:true,force:true});
  }
});

import { chmodSync, lstatSync, symlinkSync } from 'node:fs';
it('short endpoint directory rejects symlinks and unsafe permissions without modifying them', { skip: process.platform === 'win32' }, () => {
  const root=mkdtempSync(join(tmpdir(),'fb-path-safety-'));
  const state=join(root,'deep-state-'.repeat(12)); mkdirSync(state);
  const adapter=createPlatformAdapter();
  const endpoint=adapter.getIpcPath(state);
  const socketDir=dirname(endpoint);
  const victim=join(root,'victim'); mkdirSync(victim,{mode:0o755});
  try {
    assert.equal(lstatSync(socketDir).mode & 0o777,0o700);
    rmdirSync(socketDir); symlinkSync(victim,socketDir);
    assert.throws(()=>adapter.getIpcPath(state),/Unsafe Session Server IPC directory/);
    assert.equal(lstatSync(victim).mode & 0o777,0o755);
    unlinkSync(socketDir); mkdirSync(socketDir,{mode:0o700}); chmodSync(socketDir,0o755);
    assert.throws(()=>adapter.getIpcPath(state),/Unsafe Session Server IPC directory/);
    assert.equal(lstatSync(socketDir).mode & 0o777,0o755);
  } finally {rmSync(socketDir,{force:true,recursive:true});rmSync(root,{force:true,recursive:true});}
});
it('deep canonical state-directory aliases resolve to the same endpoint', { skip: process.platform === 'win32' }, () => {
  const root=mkdtempSync(join(tmpdir(),'fb-path-alias-'));
  const state=join(root,'deep-state-'.repeat(12)); mkdirSync(state);
  const alias=join(root,'deep-alias-'.repeat(12)); symlinkSync(state,alias);
  const endpoint=createPlatformAdapter().getIpcPath(state);
  try {assert.equal(createPlatformAdapter().getIpcPath(alias),endpoint);}
  finally {rmdirSync(dirname(endpoint));rmSync(root,{force:true,recursive:true});}
});


for (const replyType of ['hello_ok', 'hello_error'] as const) {
it(`refuses a legacy v1 ${replyType} and preserves its endpoint and token`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-legacy-hello-'));
  const ipcPath = createPlatformAdapter().getIpcPath(dir);
  const tokenPath = resolveSessionServerTokenPath(dir);
  writeSessionServerTokenFile(tokenPath, token);
  const sockets = new Set<Socket>();
  let spawnCount = 0;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => socket.write(JSON.stringify({
      type: replyType, protocolVersion: 1, pid: process.pid,
      message: 'unsupported protocol version', startedAt: new Date().toISOString()
    }) + '\n'));
  });
  try {
    await new Promise<void>(resolve => server.listen(ipcPath, resolve));
    await assert.rejects(startAndConnectSessionServer({
      stateDir: dir,
      spawnImpl: (() => { spawnCount++; throw new Error('must not spawn'); }) as typeof import('node:child_process').spawn
    }), /server (?:protocol )?v1.*requires v2.*restart/i);
    assert.equal(spawnCount, 0);
    assert.equal(server.listening, true);
    assert.equal(readFileSync(tokenPath, 'utf8'), token);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
}
