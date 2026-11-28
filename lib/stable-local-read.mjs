import {closeSync,constants,fstatSync,openSync,readSync} from 'node:fs';

const LIMIT=16*1024*1024;

/** Read one regular file from a single descriptor in an operator-owned
 * workspace. No stat(path)/read(path) race, final-component symlink following
 * or FIFO blocking. Reject detectable mutations during the bounded read.
 * This is not a sandbox against processes able to rewrite parent directories.
 */
export function readStableRegularFile(path,{maxBytes,rejectExecutable=false}={}){
 if(typeof path!=='string'||!path||!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>LIMIT||typeof rejectExecutable!=='boolean')throw Error('DLKT_LOCAL_READ_ARGUMENT');
 if(!constants.O_NOFOLLOW||!constants.O_NONBLOCK)throw Error('DLKT_LOCAL_READ_PLATFORM');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=fstatSync(fd,{bigint:true});
  if(!before.isFile()||(rejectExecutable&&(before.mode&0o111n)!==0n))throw Error('DLKT_LOCAL_READ_TYPE');
  if(before.size<0n||before.size>BigInt(maxBytes))throw Error('DLKT_LOCAL_READ_SIZE');
  const bytes=Buffer.alloc(Number(before.size));
  let offset=0;
  while(offset<bytes.length){
   const count=readSync(fd,bytes,offset,bytes.length-offset,offset);
   if(count<=0)throw Error('DLKT_LOCAL_READ_CHANGED');
   offset+=count;
  }
  if(readSync(fd,Buffer.alloc(1),0,1,offset)!==0)throw Error('DLKT_LOCAL_READ_CHANGED');
  const after=fstatSync(fd,{bigint:true});
  for(const key of ['dev','ino','mode','size','mtimeNs','ctimeNs']){
   if(before[key]!==after[key])throw Error('DLKT_LOCAL_READ_CHANGED');
  }
  return bytes;
 }finally{closeSync(fd);}
}
