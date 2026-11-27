import type {IncomingMessage,ServerResponse} from 'node:http';
import {respond,sameOrigin} from '../account/http.js';
import {EDITORIAL_BATCH_BYTES} from './editorial-batch.js';
import type {EditorialTransportLab,EditorialWriteResult} from './editorial-transport.js';

const MARKER='editorial-exposure-lab-v1';
export const EDITORIAL_LAB_INGEST_PATH='/__qa/editorial-transport/exposure';
export const EDITORIAL_LAB_WITHDRAW_PATH='/__qa/editorial-transport/withdraw';
const status:Readonly<Record<EditorialWriteResult,number>>={
 accepted:200,duplicate:200,'conflicting-replay':409,'invalid-batch':400,'unknown-grant':401,revoked:401,expired:401,capacity:429,held:503,
};
type BodyResult={readonly status:'ok';readonly bytes:Buffer}|{readonly status:'invalid'|'oversize'};
function header(req:IncomingMessage,name:string):string|null{
 const value=req.headers[name];return typeof value==='string'?value:null;
}
function privacyBlocked(req:IncomingMessage):boolean{
 return ['sec-gpc','dnt'].some(name=>req.headers[name]!==undefined&&header(req,name)!=='0');
}
async function body(req:IncomingMessage,max:number):Promise<BodyResult>{
 const rawLength=req.headers['content-length'];
 if(rawLength!==undefined){
  if(typeof rawLength!=='string'||!/^\d+$/u.test(rawLength))return {status:'invalid'};
  if(Number(rawLength)>max)return {status:'oversize'};
 }
 const parts:Buffer[]=[];let size=0;
 try{
  for await(const raw of req.iterator({destroyOnReturn:false})){
   const chunk:unknown=raw;
   if(!Buffer.isBuffer(chunk))return {status:'invalid'};
   size+=chunk.byteLength;if(size>max)return {status:'oversize'};
   parts.push(chunk);
  }
  if(size===0)return {status:'invalid'};
  return {status:'ok',bytes:Buffer.concat(parts,size)};
 }catch{return {status:'invalid'};}
}
/** Unmounted loopback test handler. It cannot grant consent or issue tokens.
 * Never use on a public host, and never accept ambient account/audience cookies.
 * Rate limits and transactional authorization are synthetic single-process limits. */
export async function handleEditorialTransportLab(req:IncomingMessage,res:ServerResponse,lab:EditorialTransportLab):Promise<void>{
 const path=req.url,host=header(req,'host');
 if(!host||!/^127\.0\.0\.1:[1-9]\d{0,4}$/u.test(host)||
  (path!==EDITORIAL_LAB_INGEST_PATH&&path!==EDITORIAL_LAB_WITHDRAW_PATH)){
  respond(res,404,{error:'NOT_FOUND'});return;
 }
 if(req.method!=='POST'){res.setHeader('Allow','POST');respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
 if(header(req,'origin')!=='http://'+host||!sameOrigin(req,MARKER,{NODE_ENV:'development'})||
  req.headers.cookie!==undefined||req.headers['x-forwarded-proto']!==undefined||
  req.headers['x-forwarded-host']!==undefined){
  respond(res,403,{error:'REQUEST_REJECTED'});return;
 }
 const authorization=header(req,'authorization');
 if(!authorization||!/^Bearer edlab1\.[A-Za-z0-9_-]{43}$/u.test(authorization)){
  respond(res,401,{error:'GRANT_REQUIRED'});return;
 }
 const token=authorization.slice('Bearer '.length);
 if(path===EDITORIAL_LAB_INGEST_PATH&&privacyBlocked(req)){
  lab.withdraw(token);respond(res,403,{error:'PRIVACY_BLOCKED'});return;
 }
 if(!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(header(req,'content-type')??'')||
  (req.headers['content-encoding']!==undefined&&header(req,'content-encoding')!=='identity')){
  respond(res,415,{error:'INVALID_CONTENT_TYPE'});return;
 }
 const input=await body(req,path===EDITORIAL_LAB_WITHDRAW_PATH?2:EDITORIAL_BATCH_BYTES);
 if(input.status!=='ok'){
  respond(res,input.status==='oversize'?413:400,{error:'INVALID_BODY'});return;
 }
 // Recheck the grant synchronously inside the store after the body read completes.
 if(path===EDITORIAL_LAB_WITHDRAW_PATH){
  if(input.bytes.toString('utf8')!=='{}'){respond(res,400,{error:'INVALID_BODY'});return;}
  const result=lab.withdraw(token);respond(res,result==='unknown-grant'?401:200,{result});return;
 }
 const result=lab.ingest(token,input.bytes);respond(res,status[result],{result});
}
