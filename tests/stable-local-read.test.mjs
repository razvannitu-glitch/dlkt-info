import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readStableRegularFile} from '../lib/stable-local-read.mjs';

function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'dlkt-stable-read-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 return {directory,write(name,content){
  const path=join(directory,name);
  writeFileSync(path,content,{flag:'wx',mode:0o600});
  return path;
 }};
}
test('single-descriptor reads preserve exact binary and empty content within the bound',t=>{
 const f=fixture(t),bytes=Buffer.from([0,255,1,2]);
 assert.deepEqual(readStableRegularFile(f.write('binary',bytes),{maxBytes:4}),bytes);
 assert.deepEqual(readStableRegularFile(f.write('empty',''),{maxBytes:0}),Buffer.alloc(0));
});
test('stable reader refuses oversized content and invalid byte budgets',t=>{
 const f=fixture(t),file=f.write('data','abcd');
 assert.throws(()=>readStableRegularFile(file,{maxBytes:3}),/DLKT_LOCAL_READ_SIZE/u);
 for(const value of [-1,1.5,NaN,Infinity,16*1024*1024+1])assert.throws(()=>readStableRegularFile(file,{maxBytes:value}),/DLKT_LOCAL_READ_ARGUMENT/u);
});
test('stable reader rejects symbolic links, directories and missing paths',t=>{
 const f=fixture(t),file=f.write('data','safe'),link=join(f.directory,'link');
 symlinkSync(file,link);
 assert.throws(()=>readStableRegularFile(link,{maxBytes:32}));
 assert.throws(()=>readStableRegularFile(f.directory,{maxBytes:32}),/DLKT_LOCAL_READ_TYPE/u);
 assert.throws(()=>readStableRegularFile(join(f.directory,'absent'),{maxBytes:32}),{code:'ENOENT'});
});
test('export-mode reads fail closed for executable files',t=>{
 const f=fixture(t),file=f.write('script','test');
 chmodSync(file,0o700);
 assert.throws(()=>readStableRegularFile(file,{maxBytes:32,rejectExecutable:true}),/DLKT_LOCAL_READ_TYPE/u);
 assert.equal(readStableRegularFile(file,{maxBytes:32}).toString(),'test');
});
