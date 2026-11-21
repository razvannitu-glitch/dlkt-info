/** Daily delivery slot planning. A slot key identifies a local date once, including DST folds. */
export interface EditionSchedule{readonly timezone:string;readonly localTime:string;readonly weekdays:readonly number[]}
export interface EditionSlot{readonly at:string;readonly localDate:string;readonly key:string;readonly shiftedForClockChange:boolean}
export function validateSchedule(s:EditionSchedule):void{
 if(!s||typeof s.timezone!=='string'||s.timezone.length>80||!/^([01]\d|2[0-3]):[0-5]\d$/u.test(s.localTime)||!Array.isArray(s.weekdays)||!s.weekdays.length||s.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(s.weekdays).size!==s.weekdays.length)throw Error('EDITION_SCHEDULE_INVALID');
 try{new Intl.DateTimeFormat('en',{timeZone:s.timezone}).format(0);}catch{throw Error('EDITION_TIMEZONE_INVALID');}
}
export function nextEditionSlot(s:EditionSchedule,after:number,lastLocalDate:string|null=null):EditionSlot{
 validateSchedule(s);if(!Number.isFinite(after)||after<0||(lastLocalDate!==null&&!/^\d{4}-\d{2}-\d{2}$/u.test(lastLocalDate)))throw Error('EDITION_SCHEDULE_INVALID');
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:s.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
 const weekday:Record<string,number>={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};
 // Include the full preceding UTC day so the first occurrence of a repeated hour is selected.
 const begin=Math.floor(after/86_400_000)*86_400_000-86_400_000;const found=new Set<string>();
 for(let t=begin;t<begin+11*86_400_000;t+=60_000){
  const p=Object.fromEntries(formatter.formatToParts(t).map(x=>[x.type,x.value]));const day=`${p.year}-${p.month}-${p.day}`,time=`${p.hour}:${p.minute}`;
  if(found.has(day)||time<s.localTime||!s.weekdays.includes(weekday[p.weekday??'']??0))continue;
  found.add(day);if(t<=after||day===lastLocalDate)continue;
  return {at:new Date(t).toISOString(),localDate:day,key:`${s.timezone}|${day}|${s.localTime}`,shiftedForClockChange:time!==s.localTime};
 }
 throw Error('EDITION_SLOT_UNRESOLVED');
}
