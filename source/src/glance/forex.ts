import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {readBounded} from '../iceo/transport.js';
import {CURRENCIES,FX_SOURCE,isoDay,object,validFx,type Currency,type FxReference} from './contracts.js';

const XMLNS='http://www.ecb.int/vocabulary/2002-08-01/eurofxref';
const RIGHTS_REVIEW_BY='2026-12-15';
/** ECB reference data only. Never accept an endpoint or date from a visitor. */
export function parseFx(xml:string,now:number):FxReference {
 if(Buffer.byteLength(xml)>1048576||/<!DOCTYPE|<!ENTITY/iu.test(xml)||XMLValidator.validate(xml)!==true)throw Error('FX_XML_INVALID');
 const parsed:unknown=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,processEntities:false}).parse(xml);
 if(!object(parsed)||!object(parsed['gesmes:Envelope']))throw Error('FX_IDENTITY_INVALID');
 const envelope=parsed['gesmes:Envelope'];const sender=envelope['gesmes:Sender'];
 if(envelope['@_xmlns']!==XMLNS||envelope['@_xmlns:gesmes']!=='http://www.gesmes.org/xml/2002-08-01'||envelope['gesmes:subject']!=='Reference rates'||!object(sender)||sender['gesmes:name']!=='European Central Bank'||!object(envelope.Cube))throw Error('FX_IDENTITY_INVALID');
 const rows:unknown=envelope.Cube.Cube;if(!Array.isArray(rows)||rows.length<2||rows.length>100)throw Error('FX_DATES_INVALID');
 const days=new Set<string>();const references: {date:string;rates:Partial<Record<Currency,number>>}[]=[];
 for(const row of rows){
  if(!object(row)||!isoDay(row['@_time'])||days.has(row['@_time'])||Date.parse(row['@_time'])>now||!Array.isArray(row.Cube)||!row.Cube.length||row.Cube.length>100)throw Error('FX_DATE_INVALID');
  days.add(row['@_time']);const codes=new Set<string>();const rates:Partial<Record<Currency,number>>={};
  for(const entry of row.Cube){if(!object(entry)||typeof entry['@_currency']!=='string'||!/^[A-Z]{3}$/u.test(entry['@_currency'])||codes.has(entry['@_currency'])||typeof entry['@_rate']!=='string'||!/^\d+(?:\.\d+)?$/u.test(entry['@_rate']))throw Error('FX_RATE_INVALID');const code=entry['@_currency'],n=Number(entry['@_rate']);if(!Number.isFinite(n)||n<=0||n>=1e7)throw Error('FX_RATE_INVALID');codes.add(code);if(CURRENCIES.includes(code as Currency))rates[code as Currency]=n;}
  references.push({date:row['@_time'],rates});
 }
 references.sort((a,b)=>b.date.localeCompare(a.date));const latest=references[0],prior=references[1];if(!latest||!prior)throw Error('FX_DATES_INVALID');
 const result:FxReference={checkedAt:new Date(now).toISOString(),date:latest.date,previousDate:prior.date,rates:latest.rates,previousRates:prior.rates};if(!validFx(result,now))throw Error('FX_REFERENCE_EXPIRED');return result;
}
export class ForexService {
 private cached:FxReference|null=null;private next=0;private pending:Promise<FxReference|null>|null=null;
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now){}
 async read():Promise<FxReference|null>{
  const now=this.clock();if(new Date(now).toISOString().slice(0,10)>RIGHTS_REVIEW_BY)return null;
  if(now<this.next)return this.cached&&validFx(this.cached,now)?this.cached:null;if(this.pending)return this.pending;
  this.pending=this.refresh(now);try{return await this.pending;}finally{this.pending=null;}
 }
 private async refresh(now:number):Promise<FxReference|null>{
  try{const r=await this.fetcher(FX_SOURCE,{method:'GET',headers:{Accept:'application/xml,text/xml','User-Agent':'DLKT-Info/0.9.19 (+https://www.dlkt.ee)'},credentials:'omit',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)});
   if(!r.ok||!['application/xml','text/xml'].includes((r.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase()??'')){await r.body?.cancel();throw Error('FX_RESPONSE_INVALID');}
   this.cached=parseFx(await readBounded(r,1048576),now);this.next=now+3600000;return this.cached;
  }catch{this.cached=null;this.next=now+60000;return null;}
 }
}
export const forexService=new ForexService();
