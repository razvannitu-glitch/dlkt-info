import {PUBLIC_TOPICS,TOPIC_LABELS,TOPIC_DESCRIPTIONS, type Topic} from '../iceo/topics.js';
export interface DailyInterest {readonly id:string;readonly label:string;readonly description:string;readonly topics:readonly Topic[]}
/** Display groups only; persisted profiles retain their original, exact source topics. */
export const DAILY_INTERESTS:readonly DailyInterest[]=Object.freeze([
 {id:'world',label:TOPIC_LABELS.world,description:TOPIC_DESCRIPTIONS.world,topics:['world']},
 {id:'culture',label:TOPIC_LABELS.culture,description:TOPIC_DESCRIPTIONS.culture,topics:['culture']},
 {id:'digital-life',label:TOPIC_LABELS['digital-life'],description:TOPIC_DESCRIPTIONS['digital-life'],topics:['digital-life']},
 {id:'money',label:TOPIC_LABELS.business,description:TOPIC_DESCRIPTIONS.business,topics:['business']},
 {id:'health',label:TOPIC_LABELS.health,description:TOPIC_DESCRIPTIONS.health,topics:['health']},
 {id:'science-planet',label:'Science & planet',description:'Research, climate and environment',topics:['science','environment']},
 {id:'public-life',label:TOPIC_LABELS['public-affairs'],description:TOPIC_DESCRIPTIONS['public-affairs'],topics:['public-affairs']},
 ...(['technology','regulation','opportunities','money','space','weather','energy','work-education','housing','travel','food','sport'] as const).map(topic=>({id:topic==='money'?'personal-money':topic,label:TOPIC_LABELS[topic],description:TOPIC_DESCRIPTIONS[topic],topics:[topic]})),
]);
export const RECOMMENDED_DAILY_TOPICS:readonly Topic[]=Object.freeze(PUBLIC_TOPICS.filter(topic=>topic!=='regulation'&&topic!=='opportunities'&&topic!=='other'));
export const DAILY_LENGTHS=Object.freeze([{value:4,label:'Quick'},{value:8,label:'Balanced'},{value:12,label:'Extended'}] as const);
export type InterestState='true'|'false'|'mixed';
export function interestState(interest:DailyInterest,topics:readonly Topic[]):InterestState {
 const selected=interest.topics.filter(t=>topics.includes(t)).length;
 return selected===0?'false':selected===interest.topics.length?'true':'mixed';
}
export function toggleInterest(id:string,topics:readonly Topic[]):readonly Topic[]{
 const interest=DAILY_INTERESTS.find(c=>c.id===id);if(!interest)throw Error('DAILY_INTEREST_UNKNOWN');
 const selected=new Set(topics);if(interestState(interest,topics)==='true')for(const t of interest.topics)selected.delete(t);else for(const t of interest.topics)selected.add(t);
 return PUBLIC_TOPICS.filter(t=>selected.has(t));
}
