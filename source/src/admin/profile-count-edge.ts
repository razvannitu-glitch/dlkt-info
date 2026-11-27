/** Portable, aggregate-only Supabase Edge Function. Runtime secrets remain inside Supabase. */
export const PROFILE_COUNT_VERSION='dlkt-control-profile-count-1' as const;
export const PROFILE_COUNT_FUNCTION='dlkt-control-profile-count' as const;
export const RANGES=['24h','7d','30d','90d','all'] as const;
export type Range=typeof RANGES[number];
const DAY=86_400_000;
const LIMITS:Record<Exclude<Range,'all'>,number>={'24h':DAY,'7d':7*DAY,'30d':30*DAY,'90d':90*DAY};
export function parseRange(value:string|null):Range|null{
 return value===null?'7d':RANGES.includes(value as Range)?value as Range:null;
}
export function rangeStart(range:Range,now:Date):string|null{
 return range==='all'?null:new Date(now.getTime()-LIMITS[range]).toISOString();
}
function record(v:unknown):Record<string,unknown>|null{
 return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
}
function count(v:unknown):number|null{
 return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
}
export function parseContentRange(value:string|null):number|null{
 const match=/^(?:\d+-\d+|\*)\/(\d+)$/u.exec(value??'');
 return match?count(Number(match[1])):null;
}
export interface ProfileCounts{profiles:number|null;newProfiles:number|null}
export function parseProfileCounts(value:unknown,range:Range):ProfileCounts|null{
 const v=record(value);
 if(v?.version!==PROFILE_COUNT_VERSION||v.range!==range||Object.keys(v).sort().join(',')!=='newProfiles,profiles,range,version')return null;
 const profiles=count(v.profiles),newProfiles=count(v.newProfiles);
 if(profiles===null||newProfiles===null||newProfiles>profiles||(range==='all'&&profiles!==newProfiles))return null;
 return {profiles,newProfiles};
}
export interface ProfileCountEdgeConfig{
 readonly origin:string;readonly publishableKey:string;readonly secretKey:string;readonly ownerDigest:string;
}
function safeJson(status:number,value:unknown):Response{
 return new Response(JSON.stringify(value),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
  'Vary':'Authorization','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'
 }});
}
async function digest(s:string):Promise<string>{
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s.toLowerCase()));
 return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
function validConfig(c:ProfileCountEdgeConfig):boolean{
 return /^https:\/\/[a-z0-9]{20}\.supabase\.co$/u.test(c.origin)&&
  /^sb_publishable_[A-Za-z0-9_-]{20,240}$/u.test(c.publishableKey)&&
  /^sb_secret_[A-Za-z0-9_-]{20,240}$/u.test(c.secretKey)&&/^[a-f0-9]{64}$/u.test(c.ownerDigest);
}
/** Only the server-verified immutable owner may request these two fixed aggregates.
 * Never grant access based on caller-controlled metadata, headers or query parameters. */
export async function handleProfileCountEdge(req:Request,config:ProfileCountEdgeConfig,request:typeof fetch=fetch,now:Date=new Date()):Promise<Response>{
 if(req.method!=='GET')return safeJson(405,{error:'METHOD_NOT_ALLOWED'});
 if(!validConfig(config))return safeJson(503,{error:'PROFILE_COUNTS_UNAVAILABLE'});
 const auth=req.headers.get('authorization')??'';
 if(auth.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(auth))return safeJson(401,{error:'AUTHENTICATION_REQUIRED'});
 const u=new URL(req.url);
 if([...u.searchParams.keys()].some(k=>k!=='range')||u.searchParams.getAll('range').length!==1)return safeJson(400,{error:'INVALID_RANGE'});
 const range=parseRange(u.searchParams.get('range'));
 if(range===null)return safeJson(400,{error:'INVALID_RANGE'});
 try{
  const verified=await request(new URL('/auth/v1/user',config.origin),{
   method:'GET',headers:{apikey:config.publishableKey,Authorization:auth},
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7000)
  });
  if(!verified.ok){await verified.body?.cancel();return safeJson(verified.status===401||verified.status===403?401:503,{error:'AUTHENTICATION_UNAVAILABLE'});}
  const raw=await verified.text();
  if(raw.length>128_000)return safeJson(503,{error:'PROFILE_COUNTS_UNAVAILABLE'});
  const user=record(JSON.parse(raw) as unknown);
  if(!user||typeof user.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(user.id)||
   user.role!=='authenticated'||user.is_anonymous===true||typeof user.email_confirmed_at!=='string'||!Number.isFinite(Date.parse(user.email_confirmed_at))||
   await digest(user.id)!==config.ownerDigest)return safeJson(403,{error:'ACCESS_DENIED'});
  const since=rangeStart(range,now);
  const aggregate=async(start:string|null):Promise<number|null>=>{
   const url=new URL('/rest/v1/dlkt_info_profiles',config.origin);
   url.searchParams.set('select','id');if(start)url.searchParams.set('created_at','gte.'+start);
   const res=await request(url,{method:'HEAD',headers:{apikey:config.secretKey,Prefer:'count=exact',Range:'0-0'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7000)});
   return res.ok?parseContentRange(res.headers.get('content-range')):null;
  };
  const [profiles,selected]=await Promise.all([aggregate(null),since?aggregate(since):Promise.resolve(null)]);
  const result={version:PROFILE_COUNT_VERSION,range,profiles,newProfiles:since?selected:profiles};
  if(!parseProfileCounts(result,range))return safeJson(503,{error:'PROFILE_COUNTS_UNAVAILABLE'});
  return safeJson(200,result);
 }catch{return safeJson(503,{error:'PROFILE_COUNTS_UNAVAILABLE'});}
}
