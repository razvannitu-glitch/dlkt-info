import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SAFE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** Each browser invocation owns a distinct private directory. No predictable
 * shared filenames, overwrite, path traversal or symlink following on writes.
 * Keep artifacts for inspection; the caller reports the directory and owns
 * retention/cleanup. Do not copy reports into a public application directory.
 */
export function createBrowserArtifacts(label){
 if(typeof label!=='string'||!SAFE_NAME.test(label))throw Error('QA_ARTIFACT_LABEL');
 const directory=mkdtempSync(join(tmpdir(),'dlkt-browser-'+label+'-'));
 return Object.freeze({directory,write(name,data){
  if(typeof name!=='string'||!SAFE_NAME.test(name))throw Error('QA_ARTIFACT_NAME');
  if(typeof data!=='string'&&!Buffer.isBuffer(data)&&!(data instanceof Uint8Array))throw Error('QA_ARTIFACT_DATA');
  const file=join(directory,name);
  writeFileSync(file,data,{flag:'wx',mode:0o600});
  return file;
 }});
}
