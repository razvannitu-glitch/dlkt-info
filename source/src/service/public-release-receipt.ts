import {createHash} from 'node:crypto';

export interface PublicBuildReceipt {
 readonly format:'dlkt-info-public-build-1';
 readonly product:'dlkt-info';
 readonly version:string;
 readonly revision:string;
 readonly manifestSha256:string;
 readonly gitCommitSha:string|null;
 readonly indexability:'prelaunch-noindex';
 readonly runtimeVerification:'not-attested-by-receipt';
}
const isRecord=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/**
 * Public, non-secret provenance of the exact verified source manifest.
 * This is not a live health check, licensing decision, runtime permission,
 * database readiness receipt or permission to index a prelaunch build.
 */
export function createPublicBuildReceipt(manifestText:unknown, gitSha:unknown):PublicBuildReceipt {
 if(typeof manifestText!=='string'||manifestText.length===0||Buffer.byteLength(manifestText)>1_000_000)throw Error('DLKT_PUBLIC_RECEIPT_MANIFEST');
 let parsed:unknown;
 try{parsed=JSON.parse(manifestText);}catch{throw Error('DLKT_PUBLIC_RECEIPT_MANIFEST');}
 if(!isRecord(parsed)||parsed.product!=='dlkt-info'||typeof parsed.version!=='string'||
    !/^\d+\.\d+\.\d+$/u.test(parsed.version)||typeof parsed.revision!=='string'||
    !/^[a-z0-9][a-z0-9-]{2,100}$/u.test(parsed.revision)||!isRecord(parsed.files)||
    Object.keys(parsed.files).length===0)throw Error('DLKT_PUBLIC_RECEIPT_MANIFEST');
 const revision=parsed.revision as string,version=parsed.version as string;
 const commit=typeof gitSha==='string'&&/^[a-f0-9]{40}$/iu.test(gitSha)?gitSha.toLowerCase():null;
 return Object.freeze({
  format:'dlkt-info-public-build-1',product:'dlkt-info',version,revision,
  manifestSha256:createHash('sha256').update(manifestText).digest('hex'),
  gitCommitSha:commit,indexability:'prelaunch-noindex',
  runtimeVerification:'not-attested-by-receipt',
 });
}
