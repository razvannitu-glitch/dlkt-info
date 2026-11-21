import type { ReaderSettings } from '../iceo/reader.js';
import type { Topic } from '../iceo/topics.js';

export const ORGANIZATION_STORAGE_KEY = 'dlkt-organization-setup-v1';
export const ORGANIZATION_TOPICS = [
  {id:'world',label:'World',scope:'Global Voices community reporting and perspectives'},
  {id:'culture',label:'Culture',scope:'Global Voices arts and culture'},
  {id:'digital-life',label:'Digital life',scope:'EFF privacy and digital-rights advocacy'},
  {id:'business',label:'Economy',scope:'ECB publications and statistics'},
  {id:'regulation',label:'EU law',scope:'EU Publications Office legal metadata'},
  {id:'opportunities',label:'Procurement',scope:'ECB notices; eligibility and deadlines require source checks'},
  {id:'health',label:'Health',scope:'US FDA announcements; US scope'},
  {id:'public-affairs',label:'Public life',scope:'UK government communications; UK scope'},
  {id:'environment',label:'Environment',scope:'USGS Earth science releases'},
  {id:'science',label:'Science',scope:'NASA science and missions'},
] as const satisfies readonly {readonly id:Topic;readonly label:string;readonly scope:string}[];
export const ORGANIZATION_PLANS = {
  local:{name:'DLKT Local',price:'EUR 29 / location / month',unit:'For local businesses'},
  teams:{name:'DLKT Teams',price:'EUR 79 / team / month',unit:'For companies and teams'},
  public:{name:'DLKT Public',price:'Scope and price agreed individually',unit:'For institutions and associations'},
} as const;
export type OrganizationPlan = keyof typeof ORGANIZATION_PLANS;
export interface OrganizationSetup {
  readonly version:1;
  readonly plan:OrganizationPlan;
  readonly topics:readonly Topic[];
  readonly query:string;
  readonly budget:6|12;
}
export const DEFAULT_ORGANIZATION_SETUP:OrganizationSetup = Object.freeze({version:1,plan:'teams',topics:Object.freeze(['business','regulation','opportunities'] as const),query:'',budget:6});
const allowed = ORGANIZATION_TOPICS.map(t=>t.id) as readonly Topic[];
const object = (value:unknown):value is Record<string,unknown> => typeof value==='object'&&value!==null&&!Array.isArray(value);
export const organizationPlan = (value:unknown):value is OrganizationPlan => typeof value==='string'&&Object.hasOwn(ORGANIZATION_PLANS,value);
export function validOrganizationSetup(value:unknown):value is OrganizationSetup {
  return object(value)&&Object.keys(value).length===5&&value.version===1&&organizationPlan(value.plan)
    &&Array.isArray(value.topics)&&value.topics.length>0&&value.topics.length<=allowed.length
    &&value.topics.every((t:unknown)=>typeof t==='string'&&allowed.includes(t as Topic))&&new Set(value.topics).size===value.topics.length
    &&typeof value.query==='string'&&value.query.length<=200&&value.query===value.query.trim()&&!/[\u0000-\u001f\u007f\p{Surrogate}]/u.test(value.query)
    &&(value.budget===6||value.budget===12);
}
export function organizationFocusUrl(setup:OrganizationSetup):string {
  if(!validOrganizationSetup(setup))throw Error('ORGANIZATION_SETUP_INVALID');
  const hash=new URLSearchParams({org:setup.plan,topics:setup.topics.join(','),query:setup.query,cards:String(setup.budget)});
  return '/#'+hash.toString();
}
/** A URL previews public reading only. It never grants membership or saves a profile. */
export function organizationSetupFromHash(hash:string):OrganizationSetup|null {
  if(!hash.startsWith('#org=')||hash.length>1600)return null;
  const params=new URLSearchParams(hash.slice(1));
  const keys=['org','topics','query','cards'];
  if([...params.keys()].length!==4||keys.some(k=>params.getAll(k).length!==1)||[...params.keys()].some(k=>!keys.includes(k)))return null;
  const value:unknown={version:1,plan:params.get('org'),topics:(params.get('topics')??'').split(','),query:params.get('query'),budget:params.get('cards')==='6'?6:params.get('cards')==='12'?12:0};
  return validOrganizationSetup(value)?value:null;
}
export function organizationReadingSettings(setup:OrganizationSetup):ReaderSettings {
  if(!validOrganizationSetup(setup))throw Error('ORGANIZATION_SETUP_INVALID');
  return {topics:[...setup.topics],query:setup.query,budget:setup.budget,mode:'briefing'};
}
type SetupStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type RestoredSetup = {readonly state:'saved';readonly setup:OrganizationSetup}|{readonly state:'empty'|'invalid'|'blocked'};
export function restoreOrganizationSetup(storage:()=>SetupStorage):RestoredSetup {
  try {
    const raw=storage().getItem(ORGANIZATION_STORAGE_KEY);if(raw===null)return {state:'empty'};
    if(raw.length>4096)return {state:'invalid'};
    let value:unknown;try{value=JSON.parse(raw);}catch{return {state:'invalid'};}
    return validOrganizationSetup(value)?{state:'saved',setup:value}:{state:'invalid'};
  }catch{return {state:'blocked'};}
}
export function rememberOrganizationSetup(storage:()=>SetupStorage,setup:OrganizationSetup):'saved'|'blocked' {
  if(!validOrganizationSetup(setup))throw Error('ORGANIZATION_SETUP_INVALID');
  try{const s=storage();const raw=JSON.stringify(setup);s.setItem(ORGANIZATION_STORAGE_KEY,raw);return s.getItem(ORGANIZATION_STORAGE_KEY)===raw?'saved':'blocked';}catch{return 'blocked';}
}
export function forgetOrganizationSetup(storage:()=>SetupStorage):'cleared'|'blocked' {
  try{const s=storage();s.removeItem(ORGANIZATION_STORAGE_KEY);return s.getItem(ORGANIZATION_STORAGE_KEY)===null?'cleared':'blocked';}catch{return 'blocked';}
}
export function organizationPilotRequest(setup:OrganizationSetup,name:string):{readonly body:string;readonly mailto:string} {
  if(!validOrganizationSetup(setup)||name.length>100||/[\u0000-\u001f\u007f\p{Surrogate}]/u.test(name))throw Error('ORGANIZATION_REQUEST_INVALID');
  const plan=ORGANIZATION_PLANS[setup.plan];
  const body=[`Hello DLKT,`,``,`I would like to discuss a ${plan.name} pilot.`,...(name.trim()?[`Organization: ${name.trim()}`]:[]),`Proposed plan: ${plan.name}`,`Indicative price: ${plan.price}. Final scope, taxes and terms to be agreed before payment.`,`Requested reading topics: ${setup.topics.map(t=>ORGANIZATION_TOPICS.find(x=>x.id===t)?.label).join(', ')}`,`Source filter: ${setup.query||'(none)'}`,`Reading length: ${setup.budget} cards.`,``,`Please confirm the available coverage, pilot scope, duration, success measures and a final offer before any subscription starts.`,`I understand this request does not create an account, verify an organization, publish updates, activate alerts or start a paid subscription.`].join('\n');
  return {body,mailto:'mailto:office@dlkt.ee?subject='+encodeURIComponent('DLKT pilot · '+plan.name)+'&body='+encodeURIComponent(body)};
}
