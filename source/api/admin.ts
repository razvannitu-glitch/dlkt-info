import type {IncomingMessage,ServerResponse} from 'node:http';
import {accountReadiness} from '../src/account/readiness.js';
import type {Environment} from '../src/account/http.js';
import {resolveIdentitySession} from '../src/identity/session.js';
import {readIdentityCookies} from '../src/identity/cookies.js';
import type {ProvisioningProjection} from '../src/provisioning/index.js';
import {adminIds,parseRange,readAnalytics} from '../src/admin/analytics.js';
import {renderDashboard,renderUnavailable} from '../src/admin/render.js';

function send(res:ServerResponse,status:number,body:string):void{
 res.statusCode=status;
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Vary','Cookie');
 res.setHeader('X-Robots-Tag','noindex, nofollow');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 res.end(body);
}
export async function handleAdmin(req:IncomingMessage,res:ServerResponse,deps:{environment?:Environment;fetch?:typeof fetch;provisioning?:ProvisioningProjection}={}):Promise<void>{
 const env=deps.environment??process.env,request=deps.fetch??fetch;
 const ids=adminIds(env);
 if(ids.size===0){send(res,404,renderUnavailable('Not found'));return;}
 if(req.method!=='GET'){res.setHeader('Allow','GET');send(res,405,renderUnavailable('Method not allowed'));return;}
 const host=(req.headers.host??'').toLowerCase();
 const allowed=new Set(['www.dlkt.ee','info.dlkt.ee']);
 if(env.VERCEL_URL&&/^[a-z0-9.-]+\.vercel\.app$/u.test(env.VERCEL_URL))allowed.add(env.VERCEL_URL);
 if(!allowed.has(host)||req.headers['sec-fetch-site']==='cross-site'){send(res,403,renderUnavailable('Access denied'));return;}
 let range;
 try{
  const u=new URL(req.url??'/admin','https://www.dlkt.ee');
  if([...u.searchParams.keys()].some(k=>k!=='range')||u.searchParams.getAll('range').length>1)throw Error('QUERY');
  range=parseRange(u.searchParams.get('range'));
 }catch{range=null;}
 if(range===null){send(res,400,renderUnavailable('Invalid time range'));return;}
 try{
  const cookies=readIdentityCookies(req.headers.cookie);
  if(!cookies.accessToken&&!cookies.refreshToken){send(res,401,renderUnavailable('Sign in required',true));return;}
  const ready=await accountReadiness(env,request,deps.provisioning);
  if(!ready.enabled||ready.configuration.state!=='ready'){send(res,503,renderUnavailable('Control unavailable'));return;}
  const session=await resolveIdentitySession(req,res,ready.configuration,request);
  if(!session){send(res,401,renderUnavailable('Sign in required',true));return;}
  if(!ids.has(session.user.id.toLowerCase())){send(res,403,renderUnavailable('Access denied'));return;}
  const data=await readAnalytics(ready.configuration,env,range,request);
  send(res,200,renderDashboard(data));
 }catch{send(res,503,renderUnavailable('Control unavailable'));}
}
export default handleAdmin;
