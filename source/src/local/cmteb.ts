import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import type {LocalCard} from './contracts.js';

export const CMTEB_SOURCE='https://www.cmteb.ro/functionare_sistem_termoficare.php';
export interface CmtebDocument {readonly body:string;readonly checkedAt:string}
export interface CmtebResult {readonly cards:readonly LocalCard[];readonly scanned:number;readonly rejected:number}
type Element=ReturnType<typeof DomUtils.findAll>[number];
interface Notice {readonly sector:number;readonly service:string;readonly estimate:number;readonly estimateLabel:string;readonly streets:readonly string[]}
const clean=(value:string):string=>value.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim();
const plain=(node:Element):string=>clean(DomUtils.textContent(node));
const key=(value:string):string=>clean(value).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/gu,' ').trim();
const hash=(value:string):string=>createHash('sha256').update(value).digest('hex');
const serviceLabels:Readonly<Record<string,string>>={
 'oprire acc':'hot water interruptions','oprire inc':'heating interruptions','oprire acc inc':'hot water and heating interruptions',
 'deficienta acc':'reduced hot water service','deficienta inc':'reduced heating service','deficienta acc inc':'reduced hot water and heating service',
};
const timeFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

/** Resolve the operator's wall time exactly; invalid or ambiguous DST times fail closed. */
function estimateTime(value:string):number {
 const match=/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/u.exec(value);
 if(!match)throw Error('CMTEB_ESTIMATE');
 const day=`${match[3]}-${match[2]}-${match[1]}`,hour=Number(match[4]),minute=Number(match[5]);
 const base=Date.parse(`${day}T${match[4]}:${match[5]}:00Z`);
 if(!Number.isFinite(base)||hour>23||minute>59||new Date(base).toISOString().slice(0,10)!==day)throw Error('CMTEB_ESTIMATE');
 const matches=[base-7200000,base-10800000].filter(time=>{
  const parts=timeFormat.formatToParts(time),get=(type:string)=>parts.find(part=>part.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`===day&&Number(get('hour'))===hour&&Number(get('minute'))===minute;
 });
 if(matches.length!==1||matches[0]===undefined)throw Error('CMTEB_ESTIMATE');
 return matches[0];
}

/** Only public street names before the address separator; never buildings, residents or thermal-point names. */
function streetExamples(cell:Element):readonly string[] {
 const lines=DomUtils.textContent(parseDocument(DomUtils.getOuterHTML(cell).replace(/<br\s*\/?\s*>/giu,'\n'),{decodeEntities:true})).split('\n');
 const streets=new Set<string>();
 for(const line of lines){
  const match=/^\s*•\s*((?:Str|Cal|Bld|Bd|Șos|Şos|Sos|Ale|Int|Pța|Pţa|Pta|Piața|Piaţa|Intr)\.?\s+[^<>]+?)\s+-\s+/u.exec(line);
  if(!match?.[1])continue;
  const street=clean(match[1]);
  if(street.length>100||/\b(?:bl|bloc|imob|nr|apartament|telefon|email)\b/iu.test(street)||!street)continue;
  streets.add(street);
  if(streets.size===3)break;
 }
 return[...streets];
}

/** Facts from the operator's current table, not a claim about the reader's address or restored service. */
export function parseCmteb(document:CmtebDocument,now:number):CmtebResult {
 if(!Number.isFinite(now)||!document.body||Buffer.byteLength(document.body,'utf8')>1_048_576||/<!\s*(?:ENTITY|DOCTYPE[^>]*\[)/iu.test(document.body))throw Error('CMTEB_DOCUMENT');
 const checked=Date.parse(document.checkedAt);
 if(!Number.isFinite(checked)||new Date(checked).toISOString()!==document.checkedAt||checked>now+5000||now-checked>=300000)throw Error('CMTEB_FRESHNESS');
 const parsed=parseDocument(document.body,{decodeEntities:true});
 const containers=DomUtils.findAll(node=>node.name==='div'&&node.attribs.id==='ST',parsed.children);
 if(containers.length!==1||!containers[0])throw Error('CMTEB_STRUCTURE');
 const tables=DomUtils.findAll(node=>node.name==='table',containers[0].children);
 if(tables.length!==1||!tables[0])throw Error('CMTEB_STRUCTURE');
 const rows=DomUtils.findAll(node=>node.name==='tr',tables[0].children);
 if(rows.length<2||rows.length>101||!rows[0])throw Error('CMTEB_STRUCTURE');
 const headings=DomUtils.findAll(node=>node.name==='th',rows[0].children).map(node=>key(plain(node)));
 const expected=['sector','zone afectate','agentul termic afectat','cauza descrierea interventiei','data ora estimarii punerii in functiune'];
 if(headings.length!==5||headings.some((heading,index)=>heading!==expected[index]))throw Error('CMTEB_STRUCTURE');
 const grouped=new Map<number,Notice[]>(),seen=new Set<string>();let rejected=0;
 for(const row of rows.slice(1)){
  try{
   const cells=DomUtils.findAll(node=>node.name==='td',row.children);
   if(cells.length!==5||cells.some(cell=>cell.attribs.colspan||cell.attribs.rowspan))throw Error('CMTEB_ROW');
   const [sectorText,area,serviceText,cause,estimateLabel]=cells.map(plain);
   if(!sectorText||!area||!serviceText||!cause||!estimateLabel||!cells[1]||!/^[1-6]$/u.test(sectorText)||area.length>40000||cause.length>2000)throw Error('CMTEB_ROW');
   const service=serviceLabels[key(serviceText)];if(!service)throw Error('CMTEB_SERVICE');
   const estimate=estimateTime(estimateLabel),sector=Number(sectorText),identity=hash([sectorText,area,serviceText,cause,estimateLabel].join('\u0000'));
   if(seen.has(identity))throw Error('CMTEB_DUPLICATE');seen.add(identity);
   const notices=grouped.get(sector)??[];notices.push({sector,service,estimate,estimateLabel,streets:streetExamples(cells[1])});grouped.set(sector,notices);
  }catch{rejected++;}
 }
 if(!grouped.size)throw Error('CMTEB_NO_VALID_NOTICES');
 const documentHash=hash(document.body),cards:LocalCard[]=[];
 for(const [sector,notices] of [...grouped].sort(([a],[b])=>a-b)){
  const services=[...new Set(notices.map(notice=>notice.service))];
  const streets=[...new Set(notices.flatMap(notice=>notice.streets))].slice(0,3);
  const estimates=[...new Map(notices.map(notice=>[notice.estimate,notice])).values()].sort((a,b)=>a.estimate-b.estimate);
  const past=estimates.filter(notice=>notice.estimate<=now),future=estimates.filter(notice=>notice.estimate>now);
  const range=(values:readonly Notice[]):string=>values.length===1?values[0]!.estimateLabel:`${values[0]!.estimateLabel} to ${values.at(-1)!.estimateLabel}`;
  const when=[past.length?`Past estimate still listed: ${range(past)}`:'',future.length?`Estimated restoration: ${range(future)}`:''].filter(Boolean).join('. ')+' (Europe/Bucharest; not guaranteed).';
  const affected=[services.some(service=>service.includes('hot water'))?'hot water':'',services.some(service=>service.includes('heating'))?'heating':''].filter(Boolean).join(' and ');
  cards.push({
   id:`bucharest:cmteb:sector-${sector}`,kind:'utility-notice',title:`Sector ${sector}: ${affected} service notices`,
   text:`CMTEB lists ${notices.length} ${notices.length===1?'entry':'entries'} affecting parts of Sector ${sector}: ${services.join('; ')}.${streets.length?' Street examples: '+streets.join(', ')+'.':''}`,
   publisher:'Termoenergetica Bucuresti (CMTEB)',sourceUrl:CMTEB_SOURCE,sourceUpdatedAt:null,checkedAt:document.checkedAt,validFrom:document.checkedAt,validTo:new Date(checked+300000).toISOString(),
   facts:[`Listed entries in this sector: ${notices.length}`,`Affected services: ${services.join('; ')}`,when,...(streets.length?[`Some listed streets: ${streets.join(', ')}`]:[])],
   boundary:'Current operator listing, not complete service coverage or confirmation that your address is affected. Entry counts are table rows, not households or independently verified incidents. Restoration times are estimates; a past estimate still listed does not establish restoration or continued interruption. The source date is the retrieval day, not a publication date. Check the full operator list for your building.',
   context:{section:'essential',place:`Sector ${sector}, Bucharest`,when,why:'The operator lists hot water or heating service notices in this sector.',action:'Check your street and building in the official operator list.',sourceDate:new Date(checked).toISOString().slice(0,10),startsAt:null,status:'operator-notice',documentHash,documentUrl:CMTEB_SOURCE},
  });
 }
 return{cards,scanned:rows.length-1,rejected};
}
