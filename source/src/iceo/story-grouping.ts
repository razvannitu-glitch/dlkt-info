import type {EvidenceCard} from './contracts.js';
import {contextForCard} from './context.js';

export interface StoryGroup {
  /** Presentation identity, independent of the selected publisher or representative. */
  readonly key:string;
  readonly card:EvidenceCard;
  readonly related:readonly EvidenceCard[];
  readonly basis:'single'|'matching-headlines'|'shared-event';
}
type StoryOrder=(left:EvidenceCard,right:EvidenceCard)=>number;
interface ThreadAnchor {readonly key:string;readonly basis:'matching-headlines'|'shared-event';readonly strong:boolean}
const MAX_RECORDS=5000,WINDOW_MS=2*86_400_000;
const VERSION='dlkt-story-1';
const STOP_WORDS=new Set(['a','an','and','as','at','be','been','by','for','from','in','into','is','it','its','of','on','or','that','the','their','this','to','was','were','will','with']);

// This module deliberately does not import reader.ts: the reader itself uses grouping.
// Latin folding does not remove Japanese voicing or split Korean syllables.
function text(value:string):string {
  return value.normalize('NFKC').normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').normalize('NFC')
    .toLocaleLowerCase('en').replace(/[‘’]/gu,"'").replace(/[‐‑‒–—]/gu,'-').replace(/\s+/gu,' ').trim();
}
const key=(...parts:readonly unknown[]):string=>JSON.stringify([VERSION,...parts]);
const lexical=(a:string,b:string):number=>a<b?-1:a>b?1:0;
const defaultOrder:StoryOrder=(a,b)=>Date.parse(b.date)-Date.parse(a.date)||lexical(a.id,b.id);
function order(compare:StoryOrder,a:EvidenceCard,b:EvidenceCard):number {
  const result=compare(a,b);return Number.isFinite(result)&&result!==0?result:defaultOrder(a,b)||lexical(a.identity,b.identity);
}
function publicationYear(card:EvidenceCard):string|null {
  const date=new Date(card.date);return Number.isFinite(date.getTime())?String(date.getUTCFullYear()):null;
}
function countries(card:EvidenceCard):string {
  return contextForCard(card).countries.map(country=>country.code).sort().join(',');
}

/** Exact fallback retains punctuation, numbers, negation, excerpt and geography. */
function headlineAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
  const words=title.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu)??[];
  const informative=title.length>=55&&words.length>=8&&new Set(words.filter(word=>word.length>2&&!STOP_WORDS.has(word))).size>=7;
  const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Hangul}]/u.test(title)
    &&title.length>=30&&new Set(title.match(/\p{L}/gu)??[]).size>=14;
  if(!informative&&!cjk)return null;
  return {key:key('headline',title,card.summary===undefined?'':text(card.summary),countries(card)),basis:'matching-headlines',strong:false};
}

/** Preserve the existing narrow, exact reported launch-revenue equivalence. */
function launchRevenueAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
  const normalized=title.replace(/\b(?:grand theft auto|gta)\s*(?:6|vi)\b/gu,'grand theft auto 6');
  const match=/^(?:[\p{L}\p{N} &'’.-]{2,50} says )?(.{3,100}?) (?:earned|made|grossed|generated) (us\$|\$|usd)\s*(\d+(?:\.\d+)?) (billion|million|bn|m) (?:on launch day|in (?:its |the )?first day|in (?:its |the )?first 24 hours)\.?$/u.exec(normalized);
  if(!match||/\b(?:not|never|no|estimated?|projected|expected|denied|disputed|false|falsely|wrongly|incorrectly|allegedly|unconfirmed)\b/u.test(normalized))return null;
  const amount=Number(match[3]);if(!Number.isFinite(amount)||amount<=0)return null;
  return {key:key('launch-revenue',match[1],match[2]==='$'?'unspecified-dollar':'USD',amount,match[4]==='billion'||match[4]==='bn'?'billion':'million',countries(card),card.summary===undefined?'':text(card.summary)),basis:'matching-headlines',strong:false};
}

// A named event is necessary but not sufficient. A separate incident or activity
// at the same meeting must not become a negotiation merely because COP/G20 occurs.
const NEGOTIATION=/\b(?:draft|deal|agreement|accord|negotiations?|talks|communique|declaration|treaty|projet|brouillon|negociations?|pourparlers|borrador|acuerdo|negociaciones|conversaciones|rascunho|acordo|negociacoes|entwurf|abkommen|verhandlungen|proiect|acord|negocieri)\b|合意|協議|交渉|草案|协议|協議|谈判|談判|초안|합의|협상|مسودة|اتفاق|مفاوضات/u;
const PROTEST=/\b(?:protests?|protesters?|demonstrations?|manifestants?|manifestations?|protestas?|manifestacoes|demonstranten|proteste)\b|抗議|示威|抗议|시위|احتجاج/u;
const VENUE_INCIDENT=/\b(?:venue fire|fire at|evacuat(?:e|ed|ion)|bomb threat|security breach|incendie|evacuation|incendio|amenaza de bomba|brandalarm)\b|火災|避難|爆破予告|疏散|대피|حريق|إخلاء/u;
const ATTENDANCE=/\b(?:attend(?:s|ed|ance)?|boycott|withdraws? from|participants?|delegations?|participation|boicot|teilnahme|delegatii)\b|出席|欠席|参加国|참석|مشاركة/u;
const SCHEDULE=/\b(?:schedule|fixtures?|draw|calendar|calendrier|tirage|calendario|sorteo|spielplan|auslosung|programul)\b|日程|組み合わせ|赛程|賽程|抽签|抽籤|일정|대진|جدول|قرعة/u;
const TICKETS=/\b(?:tickets?|ticketing|billets?|entradas|bilhetes|bilete)\b|チケット|入場券|门票|門票|입장권|تذاكر/u;
const OPENING=/\b(?:opening ceremony|ceremonie d'ouverture|ceremonia de apertura|cerimonia de abertura|eroffnungsfeier|ceremonia de deschidere)\b|開会式|开幕式|開幕式|개막식|حفل الافتتاح/u;
const EXPLANATORY=/\b(?:anniversary|retrospective|documentary|documentaire|documental|documentario|biography|biographie|novel|roman|history of|anniversaire|aniversario|jahrestag|aniversare)\b|周年|回顧|纪录片|紀錄片|다큐멘터리/u;

/** The identified meeting itself overruns; employment hours or a side event do not establish this. */
function meetingProgress(value:string):boolean {
  const title=value.normalize('NFKC').replace(/\s+/gu,' ').trim();
  if(/\b(?:workers?|staff|employees?|overtime pay|wages?|payroll|shifts?|working hours|hours worked)\b/iu.test(title))return false;
  const match=/\b(?:summit|conference|meeting)(?:\s+(?:in|at)\s+([^.!?:;]{1,70}?))?\s+(?:enters?|continues?|runs?|goes?|heads?|extends?)(?:\s+(?:into|in|for|a|an|the|its|another|second|third|fourth|fifth|sixth|final|extra|day|days|hour|hours|of)){0,8}\s+(?:overtime|extra (?:day|days|hours?)|past (?:its |the )?deadline)\b/iu.exec(title);
  if(!match)return false;
  // "Dinner at COP31 summit runs ..." makes the summit a location, not the
  // grammatical subject of the duration update.
  if(/\b(?:at|during|inside|outside|near|within|around|alongside|beside|before|after|for|of)\b/iu.test(title.slice(0,match.index)))return false;
  const location=match[1];
  // An optional printed place clause may intervene, not a different grammatical
  // subject such as "summit dinner" or "summit in Antalya staff shift".
  return location===undefined||/^(?:the )?\p{Lu}[\p{L}\p{M}'’.-]*(?:[ ,]+\p{Lu}[\p{L}\p{M}'’.-]*){0,5}$/u.test(location);
}
function summitSubject(title:string,progress:boolean):string|null {
  // Competing activities are not a bridge between otherwise unrelated threads.
  const subjects=[VENUE_INCIDENT.test(title)?'venue-incident':null,PROTEST.test(title)?'protests':null,NEGOTIATION.test(title)||progress?'negotiations':null].filter((value):value is string=>value!==null);
  if(subjects.length>1)return null;
  if(subjects.length)return subjects[0]??null;
  return ATTENDANCE.test(title)?'attendance':SCHEDULE.test(title)?'schedule':null;
}
function explicitYear(title:string,event:string,fallback:string):string {
  const escaped=event.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  const match=new RegExp(`\\b(?:((?:19|20)\\d{2})\\s+${escaped}|${escaped}(?:\\s+(?:summit|meeting|sommet|cumbre|gipfel))?\\s+((?:19|20)\\d{2}))\\b`,'u').exec(title);
  return match?.[1]??match?.[2]??fallback;
}
function numberedEventAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
  const year=publicationYear(card);if(!year)return null;
  const summits=[...title.matchAll(/\b(cop|unga)\s*-?\s*(\d{1,3})\b/gu)].map(match=>`${match[1]}:${Number(match[2])}`);
  const annual=[...title.matchAll(/\b(g7|g8|g20|brics|asean|apec)\b/gu)].map(match=>`${match[1]}:${explicitYear(title,match[1]??'',year)}`);
  const meetings=[...new Set([...summits,...annual])];
  if(meetings.length===1){const subject=summitSubject(title,meetingProgress(card.title));if(subject)return{key:key('summit',meetings[0],subject),basis:'shared-event',strong:true};}
  if(meetings.length)return null;
  // Tournament edition + a unique activity, not a category-wide sports bucket.
  const tournament=/\b(?:fifa world cup|world cup|coupe du monde|copa del mundo|copa do mundo|weltmeisterschaft|campionatul mondial)\b|ワールドカップ|世界杯|世界盃|월드컵|كأس العالم/u.test(title)?'world-cup'
    :/\b(?:olympics?|olympic games|jeux olympiques|juegos olimpicos|jogos olimpicos|olympische spiele|jocurile olimpice)\b|オリンピック|奥运会|奧運會|올림픽|الألعاب الأولمبية/u.test(title)?'olympics'
      :/\bwimbledon\b/u.test(title)?'wimbledon':null;
  if(!tournament)return null;
  const edition=/\b((?:19|20)\d{2})\b/u.exec(title)?.[1];if(!edition)return null;
  const activity=SCHEDULE.test(title)?'schedule':TICKETS.test(title)?'tickets':OPENING.test(title)?'opening':null;if(!activity)return null;
  const sport=/\b(?:cricket|rugby|hockey|basketball|baseball)\b/u.exec(title)?.[0]??'unspecified';
  const division=/\b(?:women(?:'s)?|feminin|femenino|feminino|frauen|feminin)\b|女子|女足|여자/u.test(title)?'women':/\b(?:under[ -]?\d{1,2}|u[ -]?\d{1,2})\b/u.exec(title)?.[0]??'open';
  const season=/\b(?:winter|hiver|invierno|inverno|winterspiele|iarna)\b|冬季|冬の|동계|الشتوية/u.test(title)?'winter':/\b(?:summer|ete|verano|verao|sommerspiele|vara)\b|夏季|夏の|하계|الصيفية/u.test(title)?'summer':'unspecified';
  const youth=/\b(?:youth|jeunesse|juventud|juventude|jugend|tineret)\b|ユース|青年|청소년|للشباب/u.test(title);
  return {key:key('tournament',tournament,edition,season,youth,sport,division,activity),basis:'shared-event',strong:true};
}

const STORM_GENERIC=new Set(['warning','warnings','season','forecast','forecasts','damage','insurance','research','names','name','named','response','relief','risk','risks','alert','alerts','watch','watches','deaths','survivors','victims','nears','approaches','hits','strikes','makes','could','may','will','expected','new','a','the','un','une','el','la','de','del','en']);
const STORM_REPORT=/^(?:['’]s\s+)?(?:approach(?:es|ing)?|near(?:s|ing)?|hit(?:s|ting)?|strik(?:e|es|ing)|struck|mak(?:e|es|ing)|made|mov(?:e|es|ing)|head(?:s|ing)?|kill(?:s|ed)?|leaves?|left|death toll|damage|forecast|landfall|track|path|evacuat(?:e|es|ion)|impact|warning|winds?|rain|flood(?:s|ing)?|weaken(?:s|ed)?|strengthen(?:s|ed)?|becomes?|expected|could|may|will|is|was|has|devastat(?:es|ed)|destroy(?:s|ed)?|batter(?:s|ed)?|provoque|fait|touche|frappe|approche|cause|provoque|provoca|azota|deja|atinge|trifft|richtet|aduce|provoaca)\b/u;
function stormAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
  const year=publicationYear(card);if(!year)return null;
  const printed=card.title.normalize('NFKC').normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').normalize('NFC');
  // Require a printed proper name, not the next lower-case verb ("cyclone kills").
  // All-capital prose without an identifiable name stays ungrouped.
  const matches:string[]=[];
  for(const match of printed.matchAll(/\b(?:hurricane|tropical storm|typhoon|cyclone|ouragan|typhon|huracan|ciclon|furacao|tufao|taifun|zyklon|uragan)\s+([\p{L}][\p{L}'’-]{1,30})\b/giu)){
    const name=match[1]??'';if(!/^\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{Lu}?[\p{Ll}\p{M}]+)*$/u.test(name)||STORM_GENERIC.has(text(name)))continue;
    const after=text(printed.slice((match.index??0)+match[0].length)),before=printed.slice(0,match.index??0);
    const explicit=/^((?:18|19|20)\d{2})\b/u.exec(after)?.[1]??/\b((?:18|19|20)\d{2})\s*$/u.exec(before)?.[1];
    const report=after.replace(/^(?:18|19|20)\d{2}\b\s*/u,'');
    // In Title Case "Cyclone Kills 12" still has no name + weather predicate.
    if(!STORM_REPORT.test(report)&&!/^[:;,—-]/u.test(report))continue;
    matches.push(JSON.stringify([text(name),explicit??year]));
  }
  const names=[...new Set(matches)];if(names.length!==1)return null;
  // A name identifies this year's storm thread; forecasts, landfall and updated
  // damage counts remain separate original reports within that thread.
  return {key:key('named-storm',names[0]),basis:'shared-event',strong:true};
}

const PRODUCT_LAUNCH=/\b(?:launch(?:es|ed|ing)?|unveil(?:s|ed)?|introduc(?:e|es|ed)|releas(?:e|es|ed)|debut(?:s|ed)?|lance|lancent|lancement|devoile|devoilent|sortie|lanza|lanzamiento|presenta|lanca|lancamento|apresenta|erschein(?:t|en)|veroffentlicht|stellt vor|lanseaza|lansare|prezinta)\b|発売|発表|发布|發佈|推出|출시|공개|إطلاق|يطلق/u;
const PRODUCT_RECALL=/\b(?:recall(?:s|ed)?|rappel(?:e)?|retire du marche|retirada|recolhimento|ruckruf|rechemare)\b|リコール|召回|리콜|استدعاء/u;
const PRODUCT_REVIEW=/\b(?:review|reviews|comparison|compared|versus|vs|buying guide|testbericht|comparatif|comparacion|recenzie)\b|レビュー|比較|评测|評測|리뷰|비교/u;
const REVENUE_CONTEXT=/\b(?:earned|made|grossed|generated|revenue|billion|million|bn|estimated?|projected)\b/u;
const GENERIC_MODELS=new Set(['version','model','series','flight','mission','launch','chapter','section','article','day','week','month','year','part','episode','january','february','march','april','may','june','july','august','september','october','november','december','cop','unga','g','world','cup','olympics','top']);
const PRODUCT_TAIL=/^(?:["'”’\s]*$|["'”’\s]*[.!?:,;—-]|["'”’\s]+(?:with|without|featuring|at|in|on|for|today|tomorrow|soon|globally|worldwide|avec|sans|con|sin|com|sem|mit|ohne|cu|fara)\b)/u;
function directProductAction(before:string,after:string,action:RegExp):boolean {
  const preceding=new RegExp(`(?:${action.source})(?:\\s+(?:the|a|an|its|new|next|latest|flagship|le|la|les|un|une|nouveau|nouvelle|el|los|una|nuevo|nueva|o|os|um|uma|novo|nova|das|die|der|neue|neuen|un|o|noul|noua)){0,5}[\\s"'“”‘’]*$`,'u');
  const following=new RegExp(`^[\\s"'“”‘’]*(?:(?:is|are|was|were|be|been|being|will|would|could|may|might|has|have|had|not|never|finally|now|officially|est|sera|ete|pas|n'est|es|fue|sera|nao|e|wird|ist|nicht|este|va|fi|nu)\\s+){0,5}(?:${action.source})`,'u');
  return preceding.test(before)&&PRODUCT_TAIL.test(after)||following.test(after)
    ||/^[\s"'“”‘’]*(?:を|が)?(?:発売|発表|发布|發佈|推出|출시|공개|リコール|召回|리콜)/u.test(after);
}
function productNames(raw:string,title:string):readonly string[] {
  const names=new Set<string>();
  if(/\b(?:grand theft auto|gta)\s*(?:6|vi)\b/u.test(title))names.add('grand theft auto 6');
  for(const match of title.matchAll(/\b(iphone|ipad|pixel|windows|playstation|galaxy [asz])\s*(\d{1,3}(?:\.\d{1,2})?)(?:\s+(pro|max|ultra|mini))?\b/gu))names.add(`${match[1]} ${match[2]}${match[3]?' '+match[3]:''}`);
  // A distinctive printed model/version can be recognized without a company list.
  for(const match of raw.normalize('NFKC').matchAll(/(?<![\p{L}\p{N}])([\p{L}][\p{L}-]{1,24})[ -]*(\d{1,3}(?:\.\d{1,2}){0,2})(?:\s+(Pro|Max|Ultra|Mini))?(?![\p{L}\p{N}])/gu)){
    const name=match[1]??'',folded=text(name);if(!/\p{Lu}/u.test(name)||GENERIC_MODELS.has(folded))continue;
    names.add(`${folded} ${match[2]}${match[3]?' '+text(match[3]):''}`);
  }
  // Quoted, short product names are explicit wording, never inferred aliases.
  for(const match of raw.matchAll(/[“"‘]([^”"’]{3,50})[”"’]/gu)){
    const name=text(match[1]??'');if(name.split(' ').length<=5&&/^[\p{L}\p{N} &'’-]+$/u.test(name)&&!/\b(?:not|no|never|new|launch|release|announces?|says?|claims?)\b/u.test(name))names.add(name);
  }
  // Known alias and generic token extraction must not fabricate two products.
  if(names.has('grand theft auto 6')){names.delete('gta 6');names.delete('auto 6');}
  return [...names];
}
function productAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
  if(PRODUCT_REVIEW.test(title)||REVENUE_CONTEXT.test(title)||card.topic==='space'||/\b(?:rocket|spacecraft|satellite|orbital|space mission|launch pad|booster|payload)\b/u.test(title))return null;
  const launch=PRODUCT_LAUNCH.test(title),recall=PRODUCT_RECALL.test(title);if(launch===recall)return null;
  const names=productNames(card.title,title);if(names.length!==1)return null;
  const name=names[0]??'',escaped=name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&').replace(/ /gu,'[ -]*');
  const mention=name==='grand theft auto 6'?/\b(?:grand theft auto|gta)\s*(?:6|vi)\b/u.exec(title):new RegExp(escaped,'u').exec(title);if(!mention)return null;
  const before=title.slice(0,mention.index),after=title.slice(mention.index+mention[0].length);
  // Compatibility/possessive wording makes the named model a target, not the
  // launched object: a new case "for iPhone 18" is not the iPhone launch.
  if(/\b(?:for|pour|para|fur|pentru|compatible with|compatible avec|compatible con|works with|designed for)\b[\p{L}\p{N} '"-]{0,35}$/u.test(before)
    ||/^[\s'’:-]*(?:cases?|covers?|chargers?|adapters?|accessories|accessory|cables?|keyboards?|screen protectors?|skins?|docks?)\b|^(?:向け|用|対応)/u.test(after))return null;
  if(!directProductAction(before,after,launch?PRODUCT_LAUNCH:PRODUCT_RECALL))return null;
  return {key:key('product',name,launch?'release':'recall'),basis:'shared-event',strong:launch};
}

/** A specific personal narrative in a newly reported documentary, not all coverage of that person. */
function documentaryNarrativeAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
  if(!/\b(?:new|latest) documentary\b/u.test(title))return null;
  const printed=card.title.normalize('NFKC').replace(/\s+/gu,' ').trim();
  // A desk/role prefix is not an alias for a person. Both records must print the
  // same complete subject after that prefix; matching a first name is insufficient.
  const body=printed.replace(/^[^:]{1,80}:\s*/u,'');
  const name="(\\p{Lu}[\\p{L}\\p{M}'’.-]*(?: \\p{Lu}[\\p{L}\\p{M}'’.-]*){0,3})";
  const possessive=new RegExp(`^${name}['’]s (.{3,65}?) (?:is |was |will be )?(?:depicted|portrayed|recounted|explored|examined|told|featured) in (?:a |the )?(?:new|latest) documentary\\b`,'u').exec(body);
  const spoken=new RegExp(`^${name} (?:talks|speaks|opens up|recounts|reflects|shares|discusses)(?: about| on)? (?:his |her |their )?(.{3,65}?) in (?:a |the )?(?:new|latest) documentary\\b`,'u').exec(body);
  const match=possessive??spoken;if(!match)return null;
  const subject=text(match[1]??''),narrative=text(match[2]??'');
  const words=narrative.split(' ');
  if(words.length<2||words.length>7||!/\b(?:journey|recovery|battle|experience|career|campaign|story)$/u.test(narrative)
    ||/^(?:(?:personal|life|own|full|untold|incredible|amazing|inspiring|inspirational|remarkable|extraordinary|latest|new) )+(?:journey|recovery|battle|experience|career|campaign|story)$/u.test(narrative))return null;
  return {key:key('documentary-narrative',subject,narrative,'new-documentary'),basis:'shared-event',strong:false};
}


// A dated result is an identified draw, not all reporting about a lottery.
// Dates are printed in the original headline; publication time is never a substitute.
const DRAW_MONTH_NAMES:readonly (readonly [number,string])[]=[
 [1,'january ianuarie janvier enero janeiro gennaio januar'],[2,'february februarie fevrier febrero fevereiro febbraio februar'],
 [3,'march martie mars marzo marco marz'],[4,'april aprilie avril abril aprile'],
 [5,'may mai mayo maio maggio'],[6,'june iunie juin junio junho giugno juni'],
 [7,'july iulie juillet julio julho luglio juli'],[8,'august aout agosto'],
 [9,'september septembrie septembre septiembre setembro settembre'],[10,'october octombrie octobre octubre outubro ottobre oktober'],
 [11,'november noiembrie novembre noviembre novembro'],[12,'december decembrie decembre diciembre dezembro dicembre dezember'],
];
const DRAW_MONTHS=new Map(DRAW_MONTH_NAMES.flatMap(([month,names])=>names.split(' ').map(name=>[name,month] as const)));
const DRAW_MONTH_PATTERN=[...DRAW_MONTHS.keys()].join('|');
function drawDate(year:number,month:number,day:number):string|null {
 if(!Number.isSafeInteger(year)||year<1900||year>2099||!Number.isSafeInteger(month)||month<1||month>12||!Number.isSafeInteger(day)||day<1||day>31)return null;
 const value=new Date(Date.UTC(year,month-1,day));
 return value.getUTCFullYear()===year&&value.getUTCMonth()===month-1&&value.getUTCDate()===day?value.toISOString().slice(0,10):null;
}
interface PrintedDrawDate {readonly date:string;readonly index:number;readonly end:number}
function explicitDrawDate(title:string):PrintedDrawDate|null {
 const values:{date:string|null;index:number;end:number}[]=[];
 const add=(match:RegExpMatchArray,date:string|null):void=>{const index=match.index??-1;values.push({date,index,end:index+match[0].length});};
 for(const match of title.matchAll(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/gu))add(match,drawDate(Number(match[1]),Number(match[2]),Number(match[3])));
 for(const match of title.matchAll(/\b(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})\b/gu))add(match,drawDate(Number(match[3]),Number(match[2]),Number(match[1])));
 for(const match of title.matchAll(new RegExp('\\b(\\d{1,2})\\.?\\s+('+DRAW_MONTH_PATTERN+')\\s+((?:19|20)\\d{2})\\b','gu')))add(match,drawDate(Number(match[3]),DRAW_MONTHS.get(match[2]??'')??0,Number(match[1])));
 for(const match of title.matchAll(new RegExp('\\b('+DRAW_MONTH_PATTERN+')\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b','gu')))add(match,drawDate(Number(match[3]),DRAW_MONTHS.get(match[1]??'')??0,Number(match[2])));
 const value=values[0];return values.length===1&&value?.date!==null&&value!==undefined&&value.index>=0?{date:value.date,index:value.index,end:value.end}:null;
}
const DRAW_DATE_CONNECTORS=new Set('for on of the du del de do da des am vom din draw tirage extragerea estrazione ziehung sunday monday tuesday wednesday thursday friday saturday dimanche lundi mardi mercredi jeudi vendredi samedi duminica luni marti miercuri joi vineri sambata'.split(' '));
/** The full date must follow the results/game phrase, not an update date later in a story. */
function drawDateFollows(title:string,prefixLength:number,printed:PrintedDrawDate):boolean {
 if(printed.index<prefixLength)return false;
 const between=title.slice(prefixLength,printed.index);
 if(between.length>70||/[^\p{L}\s,:-]/u.test(between))return false;
 const words=between.replace(/[,:-]/gu,' ').trim().split(/\s+/u).filter(Boolean);
 return words.length<=6&&words.every(word=>DRAW_DATE_CONNECTORS.has(word));
}
/** This reviewed Romanian results series identifies the operator even when the title omits it.
 * Its printed URL date must equal the headline date; host, path and identity are exact.
 * Evidence: HotNews /rezultatele-loto-6-din-49-din-22-noiembrie-2026-2410659.
 */
function reviewedRomanianDrawSeries(card:EvidenceCard,date:string):boolean {
 if(card.identity!==card.sourceUrl)return false;
 try{
  const url=new URL(card.sourceUrl);
  if(url.protocol!=='https:'||url.hostname!=='hotnews.ro'||url.port||url.username||url.password||url.search||url.hash)return false;
  const match=/^\/rezultatele-loto-6-din-49-din-(\d{1,2})-([a-z]+)-((?:19|20)\d{2})-\d{5,12}\/?$/u.exec(url.pathname);
  return match!==null&&drawDate(Number(match[3]),DRAW_MONTHS.get(match[2]??'')??0,Number(match[1]))===date;
 }catch{return false;}
}
function lotteryDrawAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
 const printed=explicitDrawDate(title);if(printed===null)return null;
 const date=printed.date;
 const games=[
  /\beuro\s?millions\b/u.test(title)?'euromillions':null,
  /\beuro\s?jackpot\b/u.test(title)?'eurojackpot':null,
  /\bmega\s?millions\b/u.test(title)?'mega-millions':null,
 ].filter((value):value is string=>value!==null);
 if(games.length>1)return null;
 if(games.length===1){
  const result='(?:results?|resultats?|resultados?|risultati|ergebnisse|rezultate(?:le)?)';
  const game='(?:euro\\s?millions|euro\\s?jackpot|mega\\s?millions)';
  const lead=new RegExp('^(?:'+game+'\\s+'+result+'|'+result+'(?:\\s+(?:for|de|del|do|da|du|des|von|la))?\\s+'+game+')\\b','u').exec(title);
  // Whole-headline recognition deliberately rejects arbitrary tails: previews,
  // special draws, corrections and comparisons cannot borrow a standard draw key.
  if(!lead||!drawDateFollows(title,lead[0].length,printed)||!/^[\s.!]*$/u.test(title.slice(printed.end)))return null;
  return {key:key('lottery-draw',games[0],date,'standard'),basis:'shared-event',strong:true};
 }
 const lead=/^rezultate(?:le)?(?:\s+la)?\s+loto\b/u.exec(title);
 if(!lead||!drawDateFollows(title,lead[0].length,printed)||contextForCard(card).countries.some(country=>country.code!=='RO'))return null;
 // These complete, reviewed result templates identify the operator and daily
 // aggregate draw. Unknown suffixes or another named game/operator stay separate.
 const reviewedSeries=reviewedRomanianDrawSeries(card,date);
 const rawSuffix=title.slice(printed.end).replace(/^[\s.:-]+|[\s.!]+$/gu,'');
 // The reviewed publisher's HTML headline may include this exact site-name suffix.
 const suffix=reviewedSeries?rawSuffix.replace(/\s+-\s+hotnews\.ro$/u,''):rawSuffix;
 const operator=suffix==='loteria romana'||suffix==='numerele extrase si premiile puse in joc de loteria romana';
 if(!operator&&suffix!==''&&suffix!=='numerele castigatoare la extragerea de azi')return null;
 if(!operator&&!reviewedSeries)return null;
 return {key:key('lottery-draw','ro-lottery-results',date,'standard'),basis:'shared-event',strong:true};
}

/**
 * Conservative Romanian reported-penalty paraphrases. An identical distinctive
 * actor, positive numeric penalty and concrete cause are required. This is a
 * headline match in the existing fixed time window, not inferred case identity.
 */
function reportedPenaltyAnchor(card:EvidenceCard,title:string):ThreadAnchor|null {
 const publisherSuffix=' - '+text(card.publisher);
 let headline=title.endsWith(publisherSuffix)?title.slice(0,-publisherSuffix.length):title;
 headline=headline.replace(/[.!]?\s+(?:video|foto)$/u,'').trim();
 if(/\b(?:nu|nici|fals|falsa|zvon|zvonuri|neaga|negat|dezminte|achitat(?:a|i|e)?|achitare|anulat(?:a|i|e)?|anulare|revocat(?:a|i|e)?|revocare|apel|recurs|contestat(?:a|i|e)?|contestatie|acuzat(?:a|i|e)?|acuzatie|risca|riscand|cerut|cere|solicita|propus|propune|ar|putea|va|vor|urmeaza|biciuit(?:a|i|e)?|executat(?:a|i|e)?|aplicat(?:a|i|e)?|documentar|retrospectiva|aniversare)\b/u.test(headline))return null;
 const match=/^(.{8,160}?)\s+(?:(?:a|au)\s+fost\s+)?(?:pedepsit(?:a|i|e)?|condamnat(?:a|i|e)?|(?:a|au)\s+primit)\s+(?:cu\s+|la\s+)?(\d{1,4})\s+(?:de\s+)?(lovituri de bici|ani de inchisoare|luni de inchisoare)\s+(?:pentru|din cauza)\s+(?:(?:un|o|unui|unei)\s+)?(.+)$/u.exec(headline);
 if(!match||Number(match[2])<=0||[...headline.matchAll(/\b\d+\b/gu)].length!==1)return null;
 const actor=(match[1]??'').replace(/[,\s]+$/u,'').replace(/^(?:un|o)\s+/u,'')
  .replace(/\s+si (?:membrii|membrele) (?:trupei|echipei) sale$/u,'');
 const words=actor.match(/\p{L}+/gu)??[];
 if(actor.length<12||words.length<2||new Set(words).size<2||!/^[\p{L}][\p{L} '.-]+$/u.test(actor)
  ||/^(?:barbat|femeie|persoana|om|oameni|tanar|tanara|minor|minora|copil|alta?|inca)\b/u.test(actor))return null;
 // Remove only presentation/channel/clothing adjuncts observed in these
 // equivalent report forms. Names, places, other causes and extra numbers stay distinct.
 const cause=(match[4]??'').replace(/[.!]+$/u,'').replace(/\s+pe youtube\b/gu,'')
  .replace(/\s+fara (?:valul islamic|val islamic|valul|val|hijabul|hijab)\b/gu,'').replace(/\s+/gu,' ').trim();
 if(cause.length<4||cause.length>140||!/^[\p{L}][\p{L} '-]+$/u.test(cause))return null;
 return {key:key('reported-penalty','ro',actor,Number(match[2]),match[3],cause,countries(card),card.summary===undefined?'':text(card.summary)),
  basis:'matching-headlines',strong:false};
}

function anchor(card:EvidenceCard):ThreadAnchor|null {
  if(card.kind!=='publication'||!card.title.trim()||card.title.length>4000||!Number.isFinite(Date.parse(card.date)))return null;
  const title=text(card.title),revenue=launchRevenueAnchor(card,title);if(revenue)return revenue;
  const documentary=documentaryNarrativeAnchor(card,title);if(documentary)return documentary;
  if(!EXPLANATORY.test(title)){
    const draw=lotteryDrawAnchor(card,title);if(draw)return draw;
    const penalty=reportedPenaltyAnchor(card,title);if(penalty)return penalty;
    const vulnerability=[...new Set([...title.matchAll(/\bcve-(\d{4})-(\d{4,7})\b/gu)].map(match=>`${match[1]}-${match[2]}`))];
    if(vulnerability.length===1)return{key:key('vulnerability',vulnerability[0]),basis:'shared-event',strong:true};
    if(vulnerability.length>1)return headlineAnchor(card,title);
    const named=numberedEventAnchor(card,title)??stormAnchor(card,title)??productAnchor(card,title);if(named)return named;
  }
  return headlineAnchor(card,title);
}

function anchoredKey(subject:ThreadAnchor,card:EvidenceCard):string {
  // Weak exact-headline/claim matches have fixed two-day epoch windows. This can
  // conservatively split a boundary-spanning report, but adding/removing another
  // source can never change the key of an existing record.
  return subject.strong?subject.key:key('window',subject.key,Math.floor(Date.parse(card.date)/WINDOW_MS));
}
/** A shared subject hint is not semantic equivalence, corroboration or verified event identity. */
export function storyThreadKey(card:EvidenceCard):string|null {const subject=anchor(card);return subject?anchoredKey(subject,card):null;}

/** Same ID/identity/URL conflicts are excluded before any presentation grouping. */
function consistentRecords(records:readonly EvidenceCard[]):readonly EvidenceCard[] {
  const ids=new Map<string,Set<string>>(),identities=new Map<string,Set<string>>(),urls=new Map<string,Set<string>>();
  const add=(map:Map<string,Set<string>>,id:string,value:string):void=>{const values=map.get(id)??new Set<string>();values.add(value);map.set(id,values);};
  for(const card of records){
    add(ids,card.id,JSON.stringify([card.identity,card.sourceUrl,card.contentHash]));
    add(identities,card.identity,JSON.stringify([card.sourceUrl,card.contentHash]));
    add(urls,card.sourceUrl,JSON.stringify([card.identity,card.contentHash]));
  }
  const unique=new Map<string,EvidenceCard>();
  for(const card of records){
    if(ids.get(card.id)?.size!==1||identities.get(card.identity)?.size!==1||urls.get(card.sourceUrl)?.size!==1)continue;
    const old=unique.get(card.id);
    if(old===undefined||Date.parse(card.observedAt)>Date.parse(old.observedAt))unique.set(card.id,card);
  }
  return [...unique.values()];
}

/**
 * Callers supply their already eligible, source-checked records. This function
 * neither fetches nor adds records, and never changes original text or metadata.
 * Every grouped member has the same explicit anchor: no transitive similarity
 * chain can connect two unrelated event identities. Named edition identities
 * stay stable through the event; weak matches use fixed two-day windows.
 */
export function groupStories(records:readonly EvidenceCard[],compare:StoryOrder=defaultOrder):readonly StoryGroup[] {
  if(!Array.isArray(records)||records.length>MAX_RECORDS)throw Error('STORY_INPUT_INVALID');
  const buckets=new Map<string,{anchor:ThreadAnchor|null;cards:EvidenceCard[]}>();
  for(const card of consistentRecords(records)){
    const subject=anchor(card),id=subject?anchoredKey(subject,card):key('record',card.identity,card.sourceUrl),bucket=buckets.get(id)??{anchor:subject,cards:[]};
    bucket.cards.push(card);buckets.set(id,bucket);
  }
  const groups:StoryGroup[]=[];
  for(const [id,bucket]of buckets){
    const ordered=[...bucket.cards].sort((a,b)=>order(compare,a,b)),primary=ordered[0];if(!primary)continue;
    groups.push(Object.freeze({key:id,card:primary,related:Object.freeze(ordered.slice(1)),basis:ordered.length>1?(bucket.anchor?.basis??'matching-headlines'):'single'}));
  }
  return Object.freeze(groups.sort((a,b)=>order(compare,a.card,b.card)||lexical(a.key,b.key)));
}
