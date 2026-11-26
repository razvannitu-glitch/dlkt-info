import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export const AUDIENCE_VERSION='dlkt-audience-1' as const;
export const AUDIENCE_TTL_SECONDS=90*24*60*60;
const RANDOM_ID=/^[A-Za-z0-9_-]{43}$/;
const PAGEVIEW_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SOURCES=['direct','search','social','referral','unknown'] as const;
export type TrafficSource=typeof SOURCES[number];
export type AudienceEvent={readonly kind:'pageview';readonly id:string;readonly source:TrafficSource}|{readonly kind:'presence'};
export interface ApproximateGeography{readonly country:string|null;readonly city:string|null}
function validSecret(secret:string):boolean{
 return RANDOM_ID.test(secret)&&Buffer.from(secret,'base64url').toString('base64url')===secret;
}
function mac(secret:string,domain:string,value:string):Buffer{
 return createHmac('sha256',Buffer.from(secret,'base64url')).update(domain+'\0'+value).digest();
}
/** Call only after explicit, recorded opt-in. Never use account identifiers or IP addresses. */
export function issueAudienceToken(secret:string,nowSeconds=Math.floor(Date.now()/1000)):string{
 if(!validSecret(secret)||!Number.isSafeInteger(nowSeconds)||nowSeconds<0||nowSeconds>Number.MAX_SAFE_INTEGER-AUDIENCE_TTL_SECONDS)throw new Error('AUDIENCE_TOKEN_CONFIG');
 const unsigned='v1.'+randomBytes(32).toString('base64url')+'.'+String(nowSeconds+AUDIENCE_TTL_SECONDS);
 return unsigned+'.'+mac(secret,'dlkt-audience-token-v1',unsigned).toString('base64url');
}
export function readAudienceToken(token:unknown,secret:string,nowSeconds=Math.floor(Date.now()/1000)):string|null{
 if(typeof token!=='string'||token.length>120||!validSecret(secret)||!Number.isSafeInteger(nowSeconds)||nowSeconds<0)return null;
 const parts=token.split('.');if(parts.length!==4)return null;
 const [version,id,expires,signature]=parts;
 if(version!=='v1'||!id||!expires||!signature||!RANDOM_ID.test(id)||!RANDOM_ID.test(signature)||!/^\d{1,15}$/.test(expires))return null;
 const expiry=Number(expires);
 if(!Number.isSafeInteger(expiry)||expiry<=nowSeconds||expiry>nowSeconds+AUDIENCE_TTL_SECONDS)return null;
 if(Buffer.from(id,'base64url').toString('base64url')!==id||Buffer.from(signature,'base64url').toString('base64url')!==signature)return null;
 const unsigned=version+'.'+id+'.'+expires;
 const expected=mac(secret,'dlkt-audience-token-v1',unsigned);
 if(!timingSafeEqual(expected,Buffer.from(signature,'base64url')))return null;
 // Only this domain-separated pseudonymous digest reaches storage.
 return mac(secret,'dlkt-audience-browser-v1',id).toString('hex');
}
function isSource(value:unknown):value is TrafficSource{return typeof value==='string'&&(SOURCES as readonly string[]).includes(value);}
export function parseAudienceEvent(value:unknown):AudienceEvent|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const data=value as Record<string,unknown>,keys=Object.keys(data).sort().join(',');
 if(data.kind==='presence'&&keys==='kind')return {kind:'presence'};
 if(data.kind==='pageview'&&keys==='id,kind,source'&&typeof data.id==='string'&&PAGEVIEW_ID.test(data.id)&&isSource(data.source))return {kind:'pageview',id:data.id.toLowerCase(),source:data.source};
 return null;
}
function header(headers:Readonly<Record<string,string|string[]|undefined>>,name:string):string|null{
 const value=headers[name];return typeof value==='string'?value:null;
}
/** Only enable trustedMetadata after the ingress/platform identity is independently verified. */
export function approximateGeography(headers:Readonly<Record<string,string|string[]|undefined>>,trustedMetadata:boolean):ApproximateGeography{
 if(!trustedMetadata)return {country:null,city:null};
 const code=header(headers,'x-vercel-ip-country');
 if(!code||!/^[A-Z]{2}$/.test(code)||code==='XX'||code==='ZZ')return {country:null,city:null};
 const raw=header(headers,'x-vercel-ip-city');
 if(!raw||raw.length>480)return {country:code,city:null};
 try{
  const city=decodeURIComponent(raw).normalize('NFC').trim().replace(/\s+/gu,' ');
  if(!city||Array.from(city).length>80||Buffer.byteLength(city,'utf8')>160||!/^[\p{L}\p{M}\p{N} .,'’()\-]+$/u.test(city)||!/[\p{L}\p{N}]/u.test(city))return {country:code,city:null};
  return {country:code,city};
 }catch{return {country:code,city:null};}
}
