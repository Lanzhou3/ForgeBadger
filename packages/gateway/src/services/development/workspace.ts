import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeResolve, validateProjectRoot } from '../../lib/safe-resolve.js';
import { developmentPlanSchema, sourcePathSchema, type DevelopmentPlan } from './contracts.js';

export const MAX_SOURCE_BYTES=64*1024;
const MAX_SNAPSHOT_BYTES=5*1024*1024;
export const hashText=(value:string)=>createHash('sha256').update(value).digest('hex');
export function permittedSourcePath(value:string):string {
  sourcePathSchema.parse(value);
  if (/(^|[/_.-])(credentials?|secrets?|passwords?|id_rsa|id_ed25519)([/_.-]|$)/i.test(value)
    || /\.(pem|p12|pfx|key|db|sqlite|sqlite3|crt|cer|node|wasm)$/i.test(value)) throw new Error('DEVELOPMENT_SOURCE_FORBIDDEN');
  return value;
}
export function sourcePath(root:string,value:string,mustExist=true):string {
  permittedSourcePath(value);const canonical=fs.realpathSync(root);validateProjectRoot(canonical);
  let current=canonical;
  for(const part of value.split('/')) { current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('DEVELOPMENT_SYMLINK_FORBIDDEN');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;} }
  const resolved=safeResolve(canonical,value);
  if(mustExist&&!fs.existsSync(resolved))throw new Error('DEVELOPMENT_SOURCE_MISSING');
  return resolved;
}
export function readSource(root:string,value:string) {
  const target=sourcePath(root,value);const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {const stat=fs.fstatSync(fd);if(!stat.isFile())throw new Error('DEVELOPMENT_SOURCE_NOT_REGULAR');if(stat.size>MAX_SOURCE_BYTES)throw new Error('DEVELOPMENT_SOURCE_TOO_LARGE');
    const buffer=Buffer.allocUnsafe(MAX_SOURCE_BYTES+1);let size=0;while(size<buffer.length){const count=fs.readSync(fd,buffer,size,buffer.length-size,null);if(!count)break;size+=count;}const data=buffer.subarray(0,size);if(data.length>MAX_SOURCE_BYTES||data.includes(0))throw new Error('DEVELOPMENT_SOURCE_NOT_TEXT');
    const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);return {path:value,content,sha256:hashText(content),bytes:data.length};
  } finally {fs.closeSync(fd);}
}
export function listSourceFiles(root:string,directory='',limit=100) {
  const start=directory?sourcePath(root,directory):fs.realpathSync(root);validateProjectRoot(start);
  const files:string[]=[];let visited=0;let truncated=false;
  function walk(dir:string,depth:number) {
    if(depth>10||visited>2000||files.length>=limit){truncated=true;return;}
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(++visited>2000||files.length>=limit){truncated=true;return;}
      const full=path.join(dir,entry.name),relative=path.relative(fs.realpathSync(root),full).split(path.sep).join('/');
      try{permittedSourcePath(relative);}catch{continue;}
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()){if(!['dist','build','coverage','vendor'].includes(entry.name))walk(full,depth+1);}
      else if(entry.isFile())files.push(relative);
    }
  }
  walk(start,0);return {files,truncated};
}
export interface PreparedSource {plan:DevelopmentPlan;root:string;before:Map<string,string>;after:Map<string,string>;sourceDigest:string;outputDigest:string;recipeDigest:string;}
export function treeDigest(files:Map<string,string>):string {return hashText(JSON.stringify([...files].sort(([a],[b])=>a.localeCompare(b)).map(([p,c])=>[p,hashText(c)])));}
export function prepareSource(root:string,raw:unknown):PreparedSource {
  const plan=developmentPlanSchema.parse(raw);const canonical=fs.realpathSync(root);validateProjectRoot(canonical);
  if(new Set(plan.sourceFiles).size!==plan.sourceFiles.length||new Set(plan.changes.map(c=>c.path)).size!==plan.changes.length||new Set(plan.checks.map(c=>c.path)).size!==plan.checks.length)throw new Error('DEVELOPMENT_DUPLICATE_PATH');
  const before=new Map<string,string>();let bytes=0;
  for(const file of plan.sourceFiles){const source=readSource(canonical,file);bytes+=source.bytes;if(bytes>MAX_SNAPSHOT_BYTES)throw new Error('DEVELOPMENT_SNAPSHOT_TOO_LARGE');before.set(file,source.content);}
  const after=new Map(before);
  for(const change of plan.changes) {
    const target=sourcePath(canonical,change.path,false);const previous=before.get(change.path);
    if(change.beforeSha256===null){if(fs.existsSync(target)||change.content===null)throw new Error('DEVELOPMENT_CREATE_CONFLICT');}
    else if(previous===undefined||hashText(previous)!==change.beforeSha256)throw new Error('DEVELOPMENT_SOURCE_DRIFT');
    if(change.content===null)after.delete(change.path);else {if(Buffer.byteLength(change.content)>MAX_SOURCE_BYTES||change.content.includes('\0'))throw new Error('DEVELOPMENT_SOURCE_TOO_LARGE');after.set(change.path,change.content);}
  }
  if(after.size>200||[...after.values()].reduce((n,c)=>n+Buffer.byteLength(c),0)>MAX_SNAPSHOT_BYTES)throw new Error('DEVELOPMENT_SNAPSHOT_TOO_LARGE');
  for(const check of plan.checks){const content=after.get(check.path);if(content===undefined||hashText(content)!==check.sha256||! /\.(cjs|mjs|js)$/.test(check.path))throw new Error('DEVELOPMENT_CHECK_DRIFT');}
  return {plan,root:canonical,before,after,sourceDigest:treeDigest(before),outputDigest:treeDigest(after),recipeDigest:hashText(JSON.stringify(plan))};
}
export function writeWorkspace(directory:string,prepared:PreparedSource) {
  fs.mkdirSync(directory,{recursive:false,mode:0o700});
  for(const [relative,content] of prepared.after){const target=sourcePath(directory,relative,false);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,content,{mode:0o400,flag:'wx'});}
}
export function assertWorkspace(directory:string,prepared:PreparedSource) {
  const actual=new Map<string,string>();
  function visit(dir:string){for(const name of fs.readdirSync(dir)){const full=path.join(dir,name),stat=fs.lstatSync(full),relative=path.relative(directory,full).split(path.sep).join('/');
    permittedSourcePath(relative);if(stat.isSymbolicLink())throw new Error('DEVELOPMENT_ARTIFACT_DRIFT');
    if(stat.isDirectory())visit(full);else if(stat.isFile()){if(actual.size>=200)throw new Error('DEVELOPMENT_ARTIFACT_DRIFT');actual.set(relative,readSource(directory,relative).content);}else throw new Error('DEVELOPMENT_ARTIFACT_DRIFT');
  }}
  visit(directory);if(treeDigest(actual)!==prepared.outputDigest)throw new Error('DEVELOPMENT_ARTIFACT_DRIFT');
}
export function sourceDiff(prepared:PreparedSource):string {
  const blocks:string[]=[];
  for(const change of prepared.plan.changes){const before=prepared.before.get(change.path),after=prepared.after.get(change.path);if(before===after)continue;
    const lines=(value:string|undefined)=>value?value.replace(/\n$/,'').split('\n'):[];
    const oldLines=lines(before),newLines=lines(after);
    const section=(values:string[],prefix:string,original:string|undefined)=>values.map(l=>prefix+l).concat(original&&!original.endsWith('\n')?['\\ No newline at end of file']:[]);
    blocks.push(`--- ${before===undefined?'/dev/null':'a/'+change.path}\n+++ ${after===undefined?'/dev/null':'b/'+change.path}\n@@ -${oldLines.length?1:0},${oldLines.length} +${newLines.length?1:0},${newLines.length} @@\n`+section(oldLines,'-',before).concat(section(newLines,'+',after)).join('\n'));
  }
  const diff=blocks.length?blocks.join('\n')+'\n':'';if(Buffer.byteLength(diff)>128*1024)throw new Error('DEVELOPMENT_DIFF_TOO_LARGE');return diff;
}
