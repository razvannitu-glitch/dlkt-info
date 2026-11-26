import {isUuid} from '../data/guards.js';

/** Only a trusted server-side billing adapter may implement this reader.
 * Never use browser JSON, JWT custom claims, Checkout returns or the laboratory
 * synthetic entitlement reader. The default runtime has NO reader until the
 * real financial evidence and persistence boundary are released.
 */
export interface ConnectionAccessReader {
  read(ownerId:string,sessionHash:string):Promise<unknown>;
}
export type ConnectionAccessStamp=Readonly<{
  accountId:string;subscriptionId:string;generation:string;fence:string;epoch:string;
  verifiedAt:number;validUntil:number;
}>;
const own=(x:unknown,k:string):unknown=>{
  if(typeof x!=='object'||x===null||Array.isArray(x))return undefined;
  const d=Object.getOwnPropertyDescriptor(x,k);
  return d&&Object.hasOwn(d,'value')?d.value as unknown:undefined;
};
const id=(x:unknown,prefix:string):x is string=>typeof x==='string'&&x.length<=255&&x.startsWith(prefix)&&/^[A-Za-z0-9]+$/u.test(x.slice(prefix.length));
const counter=(x:unknown,zero:boolean):x is string=>typeof x==='string'&&/^(?:0|[1-9][0-9]{0,18})$/u.test(x)&&BigInt(x)<=9223372036854775807n&&(zero||x!=='0');
const time=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>0&&x<=253402300799;
export async function currentConnectionAccess(reader:ConnectionAccessReader|undefined,ownerId:string,sessionHash:string,clock:()=>Date):Promise<ConnectionAccessStamp|null>{
  try {
    if(!reader||!isUuid(ownerId)||!/^[A-Za-z0-9_-]{43}$/u.test(sessionHash))return null;
    const x=await reader.read(ownerId,sessionHash);
    const now=Math.floor(clock().getTime()/1000);
    const accountId=own(x,'accountId'),subscriptionId=own(x,'subscriptionId'),generation=own(x,'generation'),fence=own(x,'fence'),epoch=own(x,'epoch'),
      verifiedAt=own(x,'verifiedAt'),validUntil=own(x,'validUntil');
    if(own(x,'state')!=='premium'||own(x,'source')!=='stripe_reconciled'||own(x,'liveMode')!==true
      ||own(x,'ownerId')!==ownerId||own(x,'sessionHash')!==sessionHash
      ||!id(accountId,'acct_')||!id(subscriptionId,'sub_')||!counter(generation,false)||!counter(fence,false)||!counter(epoch,true)
      ||!time(now)||!time(verifiedAt)||!time(validUntil)||verifiedAt>now||validUntil<=now||validUntil>verifiedAt+300)return null;
    return Object.freeze({accountId,subscriptionId,generation,fence,epoch,verifiedAt,validUntil});
  }catch{return null;}
}
export function sameConnectionAccess(a:ConnectionAccessStamp,b:ConnectionAccessStamp):boolean {
  return a.accountId===b.accountId&&a.subscriptionId===b.subscriptionId&&a.generation===b.generation&&a.fence===b.fence&&a.epoch===b.epoch
    &&a.verifiedAt===b.verifiedAt&&a.validUntil===b.validUntil;
}
