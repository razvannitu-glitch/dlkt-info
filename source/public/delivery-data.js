(() => {
  'use strict';

  const actionApi = window.DLKTActionControl;
  const inboxApi = window.DLKTActionInbox;
  if (!actionApi || !inboxApi) throw new Error('DELIVERY_DEPENDENCY_UNAVAILABLE');

  const VERSION = 'dlkt-info-delivery-control-1';
  const MARKER = 'delivery-v1';
  const DELIVERY_KEYS = Object.freeze(['delivery','dw','dr','dc','dx','di','qh','qs','qe','cap','gap','bypass','conflict','trustFloor','materialityFloor','channel']);
  const FOREIGN_KEYS = new Set([
    'bridge','topics','entities','tz','at','max','min','actionable','trust','level','conflicts','authority','sources','age','officialHigh',
    'actions','watch','remind','compare','resolved','ignore','_vercel_share',
  ]);
  const MODE_KEY = Object.freeze({ dw:'watch-change', dr:'remind-next-briefing', dc:'compare-next', dx:'mark-resolved', di:'ignore-pattern' });
  const TYPE_KEY = Object.freeze(Object.fromEntries(Object.entries(MODE_KEY).map(([key,value]) => [value,key])));
  const DEFAULT_POLICY = Object.freeze({
    timezone:'Europe/Bucharest', channel:'web', quietHoursEnabled:true, quietStart:'22:00', quietEnd:'07:00', dailyAlertCap:3, minimumGapMinutes:90,
    quietHoursBypass:'never', conflictMode:'briefing', minimumAlertTrust:'confirmed', minimumAlertMateriality:'high', requireOfficialForHighImpact:true,
    actionModes:Object.freeze({'watch-change':'alert','remind-next-briefing':'briefing','compare-next':'briefing','mark-resolved':'off','ignore-pattern':'off'}),
  });
  const META = Object.freeze({
    'demo-tech-pricing': Object.freeze({ officialEvidence:true, trust:'confirmed', materiality:'high', duplicateKey:'demo-ai-platform:pricing', source:'Official pricing page' }),
    'demo-market-entry': Object.freeze({ officialEvidence:false, trust:'corroborated', materiality:'high', duplicateKey:'demo-competitor:market-entry', source:'Two primary partner announcements' }),
    'demo-eu-consultation': Object.freeze({ officialEvidence:true, trust:'confirmed', materiality:'medium', duplicateKey:'demo-eu-consultation:deadline', source:'Official consultation portal' }),
    'demo-grant-window': Object.freeze({ officialEvidence:true, trust:'confirmed', materiality:'high', duplicateKey:'demo-fund:window', source:'Official funding portal' }),
    'demo-route': Object.freeze({ officialEvidence:true, trust:'corroborated', materiality:'medium', duplicateKey:'demo-airline:route', source:'Primary timetable' }),
    'demo-supply': Object.freeze({ officialEvidence:true, trust:'conflicting', materiality:'high', duplicateKey:'demo-component:availability', source:'Manufacturer and distributor disagree' }),
  });
  const TRUST_RANK = Object.freeze({'single-source':0,conflicting:0,corroborated:1,confirmed:2});
  const MATERIALITY_RANK = Object.freeze({low:0,medium:1,high:2,critical:3});
  const DISPOSITION_ORDER = Object.freeze({'notify-now':0,'defer-quiet-hours':1,'rate-limited':2,'next-briefing':3,scheduled:4,waiting:5,'attention-resolved':6,muted:7,'blocked-conflict':8,'suppressed-policy':9});
  const LABELS = Object.freeze({
    'notify-now':'Notify now','defer-quiet-hours':'After quiet hours','next-briefing':'Next briefing',scheduled:'Scheduled',waiting:'Waiting','attention-resolved':'Attention resolved',muted:'Muted','rate-limited':'Rate limited','blocked-conflict':'Conflict blocked','suppressed-policy':'Policy off',
  });
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
  const formatterCache = new Map();

  const clonePolicy = (policy) => ({...policy,actionModes:{...policy.actionModes}});
  const pad = (value) => String(value).padStart(2,'0');
  const one = (params,key) => { const values=params.getAll(key); if(values.length>1) throw new Error('DELIVERY_QUERY_DUPLICATE'); return values[0]??null; };
  const mode = (value,fallback) => { if(value===null)return fallback; if(!['alert','briefing','off'].includes(value))throw new Error('DELIVERY_QUERY_MODE'); return value; };
  const integer = (value,fallback,min,max) => { if(value===null)return fallback; if(!/^\d+$/u.test(value))throw new Error('DELIVERY_QUERY_INTEGER'); const parsed=Number(value); if(parsed<min||parsed>max)throw new Error('DELIVERY_QUERY_RANGE'); return parsed; };

  function validTimezone(timezone){ try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(0);return true;}catch{return false;} }
  function validPolicy(policy){
    return validTimezone(policy.timezone) && ['web','email','push'].includes(policy.channel) && TIME.test(policy.quietStart) && TIME.test(policy.quietEnd)
      && Number.isInteger(policy.dailyAlertCap) && policy.dailyAlertCap>=1 && policy.dailyAlertCap<=12
      && Number.isInteger(policy.minimumGapMinutes) && policy.minimumGapMinutes>=15 && policy.minimumGapMinutes<=720
      && ['never','confirmed-official-high'].includes(policy.quietHoursBypass) && ['briefing','off'].includes(policy.conflictMode)
      && ['corroborated','confirmed'].includes(policy.minimumAlertTrust) && ['medium','high','critical'].includes(policy.minimumAlertMateriality)
      && Object.values(policy.actionModes).every((value)=>['alert','briefing','off'].includes(value));
  }
  function parseSearch(search){
    if(typeof search!=='string'||search.length>2048)return Object.freeze({state:'invalid',policy:DEFAULT_POLICY,reason:'DELIVERY_QUERY_LENGTH'});
    const params=new URLSearchParams(search),keys=[...params.keys()],has=keys.some((key)=>DELIVERY_KEYS.includes(key));
    if(!has){const timezone=params.get('tz')??DEFAULT_POLICY.timezone;const policy=clonePolicy(DEFAULT_POLICY);policy.timezone=validTimezone(timezone)?timezone:DEFAULT_POLICY.timezone;return Object.freeze({state:'absent',policy:Object.freeze({...policy,actionModes:Object.freeze(policy.actionModes)})});}
    if(keys.some((key)=>!DELIVERY_KEYS.includes(key)&&!FOREIGN_KEYS.has(key)))return Object.freeze({state:'invalid',policy:DEFAULT_POLICY,reason:'DELIVERY_QUERY_UNKNOWN'});
    try{
      if(one(params,'delivery')!==MARKER)throw new Error('DELIVERY_QUERY_MARKER');
      const policy=clonePolicy(DEFAULT_POLICY);
      for(const [key,type] of Object.entries(MODE_KEY))policy.actionModes[type]=mode(one(params,key),policy.actionModes[type]);
      policy.timezone=one(params,'tz')??policy.timezone; policy.channel=one(params,'channel')??policy.channel;
      const qh=one(params,'qh'); if(qh!==null&&!['on','off'].includes(qh))throw new Error('DELIVERY_QUERY_QUIET'); policy.quietHoursEnabled=qh===null?policy.quietHoursEnabled:qh==='on';
      policy.quietStart=one(params,'qs')??policy.quietStart; policy.quietEnd=one(params,'qe')??policy.quietEnd;
      policy.dailyAlertCap=integer(one(params,'cap'),policy.dailyAlertCap,1,12); policy.minimumGapMinutes=integer(one(params,'gap'),policy.minimumGapMinutes,15,720);
      policy.quietHoursBypass=one(params,'bypass')??policy.quietHoursBypass; policy.conflictMode=one(params,'conflict')??policy.conflictMode;
      policy.minimumAlertTrust=one(params,'trustFloor')??policy.minimumAlertTrust; policy.minimumAlertMateriality=one(params,'materialityFloor')??policy.minimumAlertMateriality;
      if(!validPolicy(policy))throw new Error('DELIVERY_QUERY_POLICY');
      return Object.freeze({state:'valid',policy:Object.freeze({...policy,actionModes:Object.freeze(policy.actionModes)})});
    }catch(error){return Object.freeze({state:'invalid',policy:DEFAULT_POLICY,reason:error instanceof Error?error.message:'DELIVERY_QUERY_INVALID'});}
  }
  function buildSearch(policy,existingSearch=''){
    if(!validPolicy(policy))throw new Error('DELIVERY_POLICY_INVALID');
    const existing=new URLSearchParams(existingSearch),params=new URLSearchParams();
    for(const [key,value] of existing.entries())if(FOREIGN_KEYS.has(key)&&!params.has(key))params.set(key,value);
    params.set('delivery',MARKER); for(const [type,key] of Object.entries(TYPE_KEY))params.set(key,policy.actionModes[type]);
    params.set('qh',policy.quietHoursEnabled?'on':'off');params.set('qs',policy.quietStart);params.set('qe',policy.quietEnd);params.set('cap',String(policy.dailyAlertCap));params.set('gap',String(policy.minimumGapMinutes));params.set('bypass',policy.quietHoursBypass);params.set('conflict',policy.conflictMode);params.set('trustFloor',policy.minimumAlertTrust);params.set('materialityFloor',policy.minimumAlertMateriality);params.set('channel',policy.channel);if(!params.has('tz'))params.set('tz',policy.timezone);
    return `?${params.toString()}`;
  }
  const buildUrl=(policy,existingSearch='',route='/delivery')=>`${route}${buildSearch(policy,existingSearch)}`;
  function localMinute(timestamp,timezone){let formatter=formatterCache.get(timezone);if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});formatterCache.set(timezone,formatter);}const parts=Object.fromEntries(formatter.formatToParts(timestamp).map((part)=>[part.type,part.value]));return Number(parts.hour)*60+Number(parts.minute);}
  const timeMinute=(value)=>{const [hour,minute]=value.split(':').map(Number);return hour*60+minute;};
  function withinQuiet(timestamp,policy){if(!policy.quietHoursEnabled)return false;const current=localMinute(timestamp,policy.timezone),start=timeMinute(policy.quietStart),end=timeMinute(policy.quietEnd);if(start===end)return true;return start<end?current>=start&&current<end:current>=start||current<end;}
  function nextLocalTime(timestamp,timezone,target){const targetMinute=timeMinute(target),start=Math.floor(timestamp/60000)*60000+60000,limit=start+3*86400000;for(let value=start;value<=limit;value+=60000)if(localMinute(value,timezone)===targetMinute)return new Date(value).toISOString();throw new Error('DELIVERY_NEXT_TIME');}
  function decision(item,disposition,reason,explanation,options={}){return Object.freeze({id:`delivery:${item.id}`,itemId:item.id,candidateId:item.candidateId,disposition,label:LABELS[disposition],channel:options.channel??null,scheduledFor:options.scheduledFor??null,reason,explanation:Object.freeze([...explanation]),quietHoursApplied:options.quietHoursApplied??false,antiSpamApplied:options.antiSpamApplied??false,automaticExecution:false,factualStateChanged:false});}
  function candidateItems(search){
    const inbox=inboxApi.fromSearch(search).projection;
    return inbox.items.map((item)=>{const meta=META[item.candidateId];if(!meta)throw new Error('DELIVERY_META_MISSING');return Object.freeze({...item,meta,dueAt:item.state==='scheduled'?'2026-11-13T06:00:00.000Z':null});});
  }
  function baseDecision(item,policy){
    if(item.state==='muted')return decision(item,'muted','An explicit ignore rule keeps this pattern quiet.',['The material change remains visible in the muted ledger.','No claim or evidence was deleted.']);
    if(item.state==='attention-resolved')return decision(item,'attention-resolved','Personal attention remains resolved.',['A future material delta can reopen attention.']);
    if(item.state==='waiting-for-delta')return decision(item,'waiting','No new material verified delta exists.',['The action remains armed.']);
    if(item.state==='scheduled')return decision(item,'scheduled','This one-time reminder belongs to the next finite briefing.',['It is not promoted to an exceptional alert by default.'],{scheduledFor:item.dueAt});
    const deliveryMode=policy.actionModes[item.type];
    if(deliveryMode==='off')return decision(item,'suppressed-policy','Delivery is disabled for this action type.',['The action remains visible in Action Control.']);
    if(item.observation.conflictActive||item.meta.trust==='conflicting')return policy.conflictMode==='briefing'?decision(item,'next-briefing','An unresolved contradiction is kept inside the briefing.',['No alert can present one source as truth.']):decision(item,'blocked-conflict','Your policy blocks unresolved contradictions.',['The candidate remains inspectable.']);
    if(deliveryMode==='briefing')return decision(item,'next-briefing','This action is configured for the next finite briefing.',['No separate notification is generated.']);
    if(!item.observation.materialDelta)return decision(item,'waiting','No material delta exists for an exceptional alert.',['The action stays armed.']);
    if(TRUST_RANK[item.meta.trust]<TRUST_RANK[policy.minimumAlertTrust])return decision(item,'next-briefing',`Trust is below the ${policy.minimumAlertTrust} alert threshold.`,['The card can remain in the next briefing.']);
    if(MATERIALITY_RANK[item.meta.materiality]<MATERIALITY_RANK[policy.minimumAlertMateriality])return decision(item,'next-briefing',`Materiality is below the ${policy.minimumAlertMateriality} alert threshold.`,['The change is retained for the next briefing.']);
    if(['high','critical'].includes(item.meta.materiality)&&policy.requireOfficialForHighImpact&&!item.meta.officialEvidence)return decision(item,'next-briefing','High-impact alerts require official evidence.',['The candidate cannot interrupt the user.']);
    if(policy.channel!=='web')return decision(item,'suppressed-policy',`${policy.channel} delivery is unavailable in protected staging.`,['No delivery endpoint is contacted.']);
    return null;
  }
  function project(policy,search,options={}){
    if(!validPolicy(policy))throw new Error('DELIVERY_POLICY_INVALID');
    const now=options.simulateQuiet?Date.parse('2026-11-12T21:30:00.000Z'):Date.parse('2026-11-12T13:30:00.000Z');
    const items=candidateItems(search),receipts=options.simulateRecent?[Object.freeze({id:'receipt:recent',candidateId:'previous',duplicateKey:'recent:other',deliveredAt:new Date(now-45*60000).toISOString(),channel:'web'})]:[];
    const active=receipts.filter((receipt)=>Date.parse(receipt.deliveredAt)>=now-86400000&&Date.parse(receipt.deliveredAt)<=now).sort((a,b)=>Date.parse(b.deliveredAt)-Date.parse(a.deliveredAt));
    const latest=active[0]?Date.parse(active[0].deliveredAt):null,projectedKeys=new Set();let projectedAlerts=0;
    const decisions=items.map((item)=>{
      const base=baseDecision(item,policy);if(base)return base;
      if(active.some((receipt)=>receipt.duplicateKey===item.meta.duplicateKey)||projectedKeys.has(item.meta.duplicateKey))return decision(item,'rate-limited','The same verified change is already represented inside the duplicate window.',['Duplicate alerts are collapsed.'],{antiSpamApplied:true});
      if(active.length+projectedAlerts>=policy.dailyAlertCap)return decision(item,'rate-limited',`The daily alert cap of ${policy.dailyAlertCap} is reached.`,['The change moves to the next briefing.'],{antiSpamApplied:true});
      const gap=policy.minimumGapMinutes*60000;if(latest!==null&&now-latest<gap)return decision(item,'rate-limited',`The ${policy.minimumGapMinutes}-minute anti-spam gap is active.`,['The next eligible time is explicit.'],{scheduledFor:new Date(latest+gap).toISOString(),antiSpamApplied:true});
      if(projectedAlerts>0)return decision(item,'rate-limited',`Another alert occupies the current ${policy.minimumGapMinutes}-minute window.`,['Interruptions are never stacked.'],{scheduledFor:new Date(now+gap).toISOString(),antiSpamApplied:true});
      const inQuiet=withinQuiet(now,policy),bypass=policy.quietHoursBypass==='confirmed-official-high'&&item.meta.trust==='confirmed'&&item.meta.officialEvidence&&['high','critical'].includes(item.meta.materiality);
      if(inQuiet&&!bypass)return decision(item,'defer-quiet-hours','Quiet hours prevent an immediate interruption.',['The candidate remains eligible.',`It can surface after ${policy.quietEnd}.`],{channel:'web',scheduledFor:nextLocalTime(now,policy.timezone,policy.quietEnd),quietHoursApplied:true});
      projectedAlerts+=1;projectedKeys.add(item.meta.duplicateKey);return decision(item,'notify-now','A material, trusted and eligible change can interrupt now.',['The reason is visible.','The user still decides what happens next.'],{channel:'web'});
    }).sort((a,b)=>DISPOSITION_ORDER[a.disposition]-DISPOSITION_ORDER[b.disposition]||a.candidateId.localeCompare(b.candidateId));
    const scheduled=decisions.map((item)=>item.scheduledFor).filter(Boolean).sort();
    return Object.freeze({version:VERSION,generatedAt:new Date(now).toISOString(),policy:Object.freeze({...policy,actionModes:Object.freeze({...policy.actionModes})}),items:Object.freeze(items),decisions:Object.freeze(decisions),notifyNowCount:decisions.filter((item)=>item.disposition==='notify-now').length,deferredCount:decisions.filter((item)=>item.disposition==='defer-quiet-hours').length,nextBriefingCount:decisions.filter((item)=>item.disposition==='next-briefing').length,waitingCount:decisions.filter((item)=>item.disposition==='waiting').length,quietCount:decisions.filter((item)=>['muted','attention-resolved','suppressed-policy','blocked-conflict'].includes(item.disposition)).length,rateLimitedCount:decisions.filter((item)=>item.disposition==='rate-limited').length,nextScheduledAt:scheduled[0]??null,simulatedQuiet:Boolean(options.simulateQuiet),simulatedRecent:Boolean(options.simulateRecent),automaticExecution:false,factualStateChanged:false});
  }
  function fromSearch(search,options={}){const parsed=parseSearch(search);return Object.freeze({queryState:parsed.state,queryReason:parsed.reason??null,projection:project(parsed.policy,search,options)});}

  Object.defineProperty(window,'DLKTDeliveryControl',{value:Object.freeze({version:VERSION,marker:MARKER,defaultPolicy:DEFAULT_POLICY,labels:LABELS,parseSearch,buildSearch,buildUrl,project,fromSearch,clonePolicy}),writable:false,configurable:false});
})();
