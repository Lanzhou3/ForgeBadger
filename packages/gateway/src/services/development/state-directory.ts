import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Database } from '../../db/types.js';

const bases=new WeakMap<Database,string>();
/** Private Gateway state, outside every sandbox read/write root. */
export function workspaceBase(db:Database):string {
 const existing=bases.get(db);if(existing)return existing;
 const base=db.name&&db.name!==':memory:'?path.join(fs.realpathSync(path.dirname(path.resolve(db.name))),'development-workspaces'):fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'forgebadger-development-')));
 privateDirectory(base);bases.set(db,base);return base;
}
export function privateDirectory(directory:string):string {
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync(directory)!==directory)throw new Error('DEVELOPMENT_ROOT_SYMLINK');
 fs.chmodSync(directory,0o700);return directory;
}
export function evidenceDirectory(db:Database):string {return privateDirectory(path.join(workspaceBase(db),'.execution-evidence'));}
