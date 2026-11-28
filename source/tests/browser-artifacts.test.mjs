import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createBrowserArtifacts} from './browser/qa-artifacts.mjs';

function fixture(t){
 const artifacts=createBrowserArtifacts('test');
 t.after(()=>rmSync(artifacts.directory,{recursive:true,force:true}));
 return artifacts;
}
test('browser artifact runs use distinct private directories and private exclusive files',t=>{
 const first=fixture(t),second=fixture(t);
 assert.notEqual(first.directory,second.directory);
 assert.equal(statSync(first.directory).mode&0o777,0o700);
 const bytes=Buffer.from([0,1,255]),file=first.write('sample.bin',bytes);
 assert.deepEqual(readFileSync(file),bytes);
 assert.equal(statSync(file).mode&0o777,0o600);
 assert.throws(()=>first.write('sample.bin','replacement'),{code:'EEXIST'});
 assert.equal(readFileSync(second.write('sample.bin','second'),'utf8'),'second');
 assert.deepEqual(readFileSync(file),bytes);
});
test('browser artifacts reject invalid basenames, data and labels',t=>{
 const artifacts=fixture(t);
 for(const name of ['','.', '..','../escape','/absolute','nested/file','nested\\file','a\0b'])assert.throws(()=>artifacts.write(name,'x'),/QA_ARTIFACT_NAME/u);
 assert.throws(()=>artifacts.write('object.json',{}),/QA_ARTIFACT_DATA/u);
 assert.throws(()=>createBrowserArtifacts('../escape'),/QA_ARTIFACT_LABEL/u);
});
test('exclusive artifact writes never follow or replace a pre-existing symlink',t=>{
 const first=fixture(t),second=fixture(t),target=second.write('target.txt','original');
 symlinkSync(target,join(first.directory,'linked.txt'));
 assert.throws(()=>first.write('linked.txt','changed'),{code:'EEXIST'});
 assert.equal(readFileSync(target,'utf8'),'original');
});
