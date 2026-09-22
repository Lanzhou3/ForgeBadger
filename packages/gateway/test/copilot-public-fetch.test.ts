import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { publicFetch } from '../src/services/extensions/public-fetch.js';

it('pins approved DNS results to the actual request and rechecks authority after DNS',async()=>{
 let lookedUp=0, sent=0;let active=true;
 const restore=()=>{mock.restoreAll();syncBuiltinESMExports();};
 mock.method(dns,'lookup',async()=>{lookedUp++;return[{address:'93.184.216.34',family:4}];});
 mock.method(https,'request',(_url:URL,options:Record<string,unknown>)=>{
  sent++;
  (options.lookup as Function)('example.com',{all:true},(error:unknown,addresses:unknown)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);});
  const req=Object.assign(new EventEmitter(),{end(){const res=Object.assign(new EventEmitter(),{statusCode:200,headers:{'content-type':'text/plain'},destroy(){}});req.emit('response',res);res.emit('data',Buffer.from('ok'));res.emit('end');},destroy(){req.emit('error',new Error('aborted'));}});
  return req;
 });syncBuiltinESMExports();
 try{const response=await publicFetch('https://example.com/',{},()=>{assert.equal(active,true);});assert.equal(await response.text(),'ok');assert.equal(lookedUp,1);assert.equal(sent,1);
  mock.method(dns,'lookup',async()=>{active=false;return[{address:'93.184.216.34',family:4}];});syncBuiltinESMExports();
  await assert.rejects(publicFetch('https://example.com/',{},()=>{if(!active)throw new Error('revoked');}),/revoked/);assert.equal(sent,1);
 }finally{restore();}
});

it('rejects mixed DNS private answers before sockets and never follows redirects',async()=>{
 let sent=0;
 mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}]);
 mock.method(https,'request',()=>{sent++;throw new Error('must not connect');});syncBuiltinESMExports();
 try{await assert.rejects(publicFetch('https://example.com/'));assert.equal(sent,0);}finally{mock.restoreAll();syncBuiltinESMExports();}
 mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
 mock.method(https,'request',()=>{
  sent++;const req=Object.assign(new EventEmitter(),{end(){req.emit('response',Object.assign(new EventEmitter(),{statusCode:302,headers:{location:'https://127.0.0.1/private'},destroy(){}}));},destroy(){}});return req;
 });syncBuiltinESMExports();
 try{await assert.rejects(publicFetch('https://example.com/'),/Redirects/);assert.equal(sent,1);}finally{mock.restoreAll();syncBuiltinESMExports();}
});

it('bounds streaming response bytes and rejects unsupported status without throwing outside promise',async()=>{
 mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);let invalid=false;
 mock.method(https,'request',()=>{
  const req=Object.assign(new EventEmitter(),{end(){
   const res=Object.assign(new EventEmitter(),{statusCode:invalid?700:200,headers:{},destroy(error?:Error){if(error)this.emit('error',error);}});
   req.emit('response',res);if(!invalid)res.emit('data',Buffer.alloc(1024*1024+1));
  },destroy(){}});return req;
 });syncBuiltinESMExports();
 try{const response=await publicFetch('https://example.com/');await assert.rejects(response.text(),/interrupted/);invalid=true;await assert.rejects(publicFetch('https://example.com/'));}
 finally{mock.restoreAll();syncBuiltinESMExports();}
});


it('bounds stalled DNS before any socket opens', async () => {
 let sent = 0;
 mock.timers.enable({apis:['setTimeout']});
 mock.method(dns,'lookup',() => new Promise(() => undefined));
 mock.method(https,'request',() => { sent++; throw new Error('unexpected socket'); });
 syncBuiltinESMExports();
 try {
   const pending = assert.rejects(publicFetch('https://example.com/'), /Unable to resolve endpoint host/);
   mock.timers.tick(15_001);
   await pending;
   assert.equal(sent,0);
 } finally { mock.timers.reset(); mock.restoreAll(); syncBuiltinESMExports(); }
});

it('terminates a stalled request without retrying', async () => {
 let sent = 0, destroyed = 0;
 mock.timers.enable({apis:['setTimeout']});
 mock.method(dns,'lookup',async () => [{address:'93.184.216.34',family:4}]);
 mock.method(https,'request',() => {
   sent++;
   const req = Object.assign(new EventEmitter(),{end(){},destroy(){destroyed++;req.emit('error',new Error('timeout'));}});
   return req;
 }); syncBuiltinESMExports();
 try {
   const pending = assert.rejects(publicFetch('https://example.com/'), /Remote request failed/);
   for (let i=0;i<20 && sent===0;i++) await Promise.resolve();
   assert.equal(sent,1);
   mock.timers.tick(15_001);
   await pending;
   assert.equal(destroyed,1); assert.equal(sent,1);
 } finally { mock.timers.reset(); mock.restoreAll(); syncBuiltinESMExports(); }
});
