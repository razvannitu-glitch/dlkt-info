import {object,stamp,type LocalCard} from './contracts.js';
export const TFL_URL='https://api.tfl.gov.uk/Line/Mode/tube/Status';
/** One card per city status check, not one repeated card for every line/status. */
export function transportCards(value:unknown,checkedAt:string,now:number):readonly LocalCard[]{
 if(!Array.isArray(value)||value.length===0||value.length>20)throw Error('TRANSPORT_INVALID');
 const ids=new Set<string>(),facts:string[]=[],affected:string[]=[];
 for(const line of value){
  if(!object(line)||typeof line.id!=='string'||!/^[a-z-]+$/u.test(line.id)||ids.has(line.id)||line.modeName!=='tube'||typeof line.name!=='string'||line.name.length>150||!Array.isArray(line.lineStatuses)||!line.lineStatuses.length)throw Error('TRANSPORT_IDENTITY_INVALID');ids.add(line.id);
  const statuses=line.lineStatuses.filter((s:unknown)=>{
   if(!object(s)||typeof s.statusSeverityDescription!=='string'||!s.statusSeverityDescription.trim()||s.statusSeverityDescription.length>300||typeof s.statusSeverity!=='number'||!Number.isInteger(s.statusSeverity)||s.statusSeverity<0||s.statusSeverity>30||!Array.isArray(s.validityPeriods))throw Error('TRANSPORT_STATUS_INVALID');
   if(!s.validityPeriods.length)return true;
   return s.validityPeriods.some((p:unknown)=>{if(!object(p)||!stamp(p.fromDate)||!stamp(p.toDate))throw Error('TRANSPORT_PERIOD_INVALID');return Date.parse(p.fromDate)<=now&&Date.parse(p.toDate)>now;});
  });
  if(!statuses.length)throw Error('TRANSPORT_NO_CURRENT_STATUS');
  const labels:string[]=[],reasons:string[]=[];let impacted=false;
  for(const status of statuses){if(!object(status))throw Error('TRANSPORT_STATUS_INVALID');const label=String(status.statusSeverityDescription);if(!labels.includes(label))labels.push(label);if(status.statusSeverity!==10)impacted=true;if(typeof status.reason==='string'&&status.reason.trim()&&!reasons.includes(status.reason.trim()))reasons.push(status.reason.trim());}
  const summary=`${line.name}: ${labels.join(' / ')}`;const fact=`${summary}${reasons.length?' — '+reasons.join(' '):''}`;if(fact.length>8000)throw Error('TRANSPORT_TEXT_INVALID');facts.push(fact);if(impacted)affected.push(summary);
 }
 const title=affected.length?`London Tube: service changes on ${affected.length} of ${ids.size} checked lines`:`TfL reports good service on ${ids.size} checked Tube lines`;
 const text=affected.length?affected.join('. ')+'. Open source details for the operator’s complete notices.':`All ${ids.size} line entries in this source check report Good Service. This is the operator’s report, not a guarantee for a later journey.`;
 return[{id:'tfl:2643743:tube-status',kind:'transport',title,text,publisher:'Transport for London',sourceUrl:'https://tfl.gov.uk/tube-dlr-overground/status/',sourceUpdatedAt:null,checkedAt,validFrom:checkedAt,validTo:new Date(Date.parse(checkedAt)+120000).toISOString(),facts,boundary:'Powered by TfL Open Data. Current Tube status when checked, not all transport or a prediction for your journey. Recheck before travelling. DLKT groups the operator’s line entries without altering the notices.'}];
}
