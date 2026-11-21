import type {IncomingMessage,ServerResponse} from 'node:http';
export type Environment=Readonly<Record<string,string|undefined>>;
function header(req:IncomingMessage,name:string):string{const v=req.headers[name];return typeof v==='string'?v:'';}
/** Validate the served host, not an arbitrary reflected Origin or forwarded host. */
export function sameOrigin(req:IncomingMessage,marker:string,env:Environment=process.env):boolean{
  if(header(req,'x-dlkt-info-request')!==marker)return false;
  const host=header(req,'host').toLowerCase();
  const hosts=new Set(['www.dlkt.ee','info.dlkt.ee']);
  if(env.VERCEL_URL&&/^[a-z0-9.-]+\.vercel\.app$/u.test(env.VERCEL_URL))hosts.add(env.VERCEL_URL);
  const local=env.NODE_ENV!=='production'&&/^127\.0\.0\.1:\d+$/u.test(host);
  const proto=header(req,'x-forwarded-proto')||(local?'http':'https');
  if(!hosts.has(host)&&!local)return false;
  if(proto!=='https'&&!(local&&proto==='http'))return false;
  const site=header(req,'sec-fetch-site');if(site&&site!=='same-origin')return false;
  const origin=header(req,'origin');
  if(origin){try{return new URL(origin).origin===`${proto}://${host}`&&new URL(origin).href===`${proto}://${host}/`;}catch{return false;}}
  return site==='same-origin'&&['cors','same-origin'].includes(header(req,'sec-fetch-mode'))&&header(req,'sec-fetch-dest')==='empty';
}
export function noQuery(req:IncomingMessage):boolean{try{const u=new URL(req.url??'/', 'https://www.dlkt.ee');return !u.search&&!u.hash;}catch{return false;}}
export function respond(res:ServerResponse,status:number,data:unknown):void{
 res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Cookie, Origin');res.end(JSON.stringify(data));
}
export async function bodyJson(req:IncomingMessage,max:number):Promise<unknown>{
 if(!/^application\/json(?:\s*;|$)/iu.test(header(req,'content-type')))throw Error('CONTENT_TYPE_REQUIRED');
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.byteLength;if(size>max)throw Error('BODY_TOO_LARGE');chunks.push(b);}
 if(!size)throw Error('BODY_EMPTY');return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export async function boundedJson(res:Response,max:number):Promise<unknown>{
 if(!/^application\/json(?:\s*;|$)/iu.test(res.headers.get('content-type')??'')){await res.body?.cancel();throw Error('ACCOUNT_UPSTREAM_INVALID');}
 const advertised=res.headers.get('content-length');if(advertised&&(!/^\d+$/u.test(advertised)||Number(advertised)>max)){await res.body?.cancel();throw Error('ACCOUNT_UPSTREAM_TOO_LARGE');}
 const reader=res.body?.getReader();if(!reader)throw Error('ACCOUNT_UPSTREAM_INVALID');const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw Error('ACCOUNT_UPSTREAM_TOO_LARGE');}chunks.push(part.value);}}finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
