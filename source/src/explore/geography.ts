import type {EvidenceCard} from '../iceo/contracts.js';
import {contextForCard} from '../iceo/context.js';
import type {City} from '../local/contracts.js';

export interface ExploreGeography {
  readonly scope:'city'|'country'|'world';
  readonly basis:'title'|'summary'|'publisher-category'|'unfiltered';
  /** Wording/category evidence only, never a verified event location or personal exposure. */
  readonly label:string;
}

// Accent-insensitive Latin names must not erase Japanese voicing or decompose Korean syllables.
const normalize=(value:string):string=>value.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').normalize('NFC').replace(/[’‘]/gu,"'").replace(/\s+/gu,' ').trim();
const lower=(value:string):string=>normalize(value).toLocaleLowerCase('en');
const escaped=(value:string):string=>value.replace(/[.*+?^$(){}|[\]\\]/gu,'\\$&');
const LETTER=/[\p{L}\p{N}]/u;
const CJK=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const KATAKANA=/\p{Script=Katakana}/u;

/** Small reviewed spelling/ambiguity exceptions supplement any catalog city, not a city allowlist. */
const CITY_NAMES:Readonly<Record<string,readonly string[]>>=Object.freeze({
  '1850147:JP':['Tokyo','Tōkyō','東京','东京都','東京都','Токио'],
  '2988507:FR':['Paris','巴黎','パリ','Париж'],
  '993800:ZA':['Johannesburg','Johannesbourg','Jozi','ヨハネスブルグ','约翰内斯堡'],
  '5128581:US':['New York','New York City','NYC','纽约','紐約','ニューヨーク'],
  '683506:RO':['Bucharest','București','Bucureşti','Bucarest'],
  '2643743:GB':['London','Londres','ロンドン','伦敦','倫敦'],
});
const COUNTRY_ALIASES:Readonly<Record<string,readonly string[]>>=Object.freeze({
  US:['United States of America','US','USA','U.S.','U.S.A.','États-Unis','米国','アメリカ'],
  GB:['United Kingdom','UK','U.K.','Britain','Great Britain','Royaume-Uni','英国'],
  JP:['Japan','日本','日本国'],FR:['France','フランス'],ZA:['South Africa','Afrique du Sud','南アフリカ'],
  KR:['South Korea','Republic of Korea'],CZ:['Czech Republic'],TR:['Türkiye','Turkey'],
});
const AMBIGUOUS_COUNTRIES=new Set(['GE','JO','TD','CG','CD','NE','OM']);
const COMMON_CITY_WORDS=new Set(['reading','nice','orange','mobile','bath','sale','gap','split','victoria','hamilton']);
const countryNames=new Map<string,readonly string[]>();
function namesForCountry(code:string):readonly string[] {
  const known=countryNames.get(code);if(known)return known;
  const values=new Set<string>(COUNTRY_ALIASES[code]??[]);
  // Match the original wording of the verified acquisition editions. Interface
  // language and publisher headquarters never become geographical evidence.
  for(const language of ['en','fr','ja','es','ar','de','pt']){
    try{const value=new Intl.DisplayNames([language],{type:'region',fallback:'none'}).of(code);if(value&&value!==code)values.add(value);}catch{/* Unknown code has no name evidence. */}
  }
  const result=Object.freeze([...values]);countryNames.set(code,result);return result;
}
function occurrences(text:string,term:string):readonly number[] {
  if(term.length<2)return[];
  const values:number[]=[],script=CJK.test(term);let offset=0;
  while(offset<text.length){
    const position=text.indexOf(term,offset);if(position<0)break;
    const before=position===0?'':text[position-1]??'',after=text[position+term.length]??'';
    const beforeBoundary=!LETTER.test(before)||script&&CJK.test(before)&&!(KATAKANA.test(term[0]??'')&&KATAKANA.test(before));
    const afterBoundary=!LETTER.test(after)||script&&CJK.test(after)&&!(KATAKANA.test(term.at(-1)??'')&&KATAKANA.test(after));
    if(beforeBoundary&&afterBoundary)values.push(position);
    offset=position+term.length;
  }
  return values;
}
function countryMention(text:string,code:string):boolean {
  const normalized=normalize(text),value=normalized.toLocaleLowerCase('en');
  return namesForCountry(code).some(name=>{
    // Uppercase abbreviations do not match the pronoun "us" or a lowercase fragment.
    if(/^[A-Z.]{2,6}$/u.test(name))return occurrences(normalized,name).length>0;
    const term=lower(name);
    return occurrences(value,term).some(position=>{
      if(code==='TR'&&term==='turkey'&&/\b(?:recipes?|roast(?:ed|ing)?|stuffing|gravy|thanksgiving|cook(?:ing|ed)?|breasts?|leftovers?|sandwich(?:es)?)\b/u.test(value)){
        const before=value.slice(Math.max(0,position-35),position),after=value.slice(position+term.length,position+term.length+45);
        const countryWording=/(?:country of|republic of|nation of)\s+$/u.test(before)
          ||/^(?:'s)?\s+(?:government|parliament|president|prime minister|ministry|national election|country)\b/u.test(after);
        const placeWording=/(?:in|across|from|to|throughout)\s+$/u.test(before)&&/\p{Lu}/u.test(normalized[position]??'');
        if(!countryWording&&!placeWording)return false;
      }
      if(!AMBIGUOUS_COUNTRIES.has(code))return true;
      const before=value.slice(Math.max(0,position-30),position),after=value.slice(position+term.length,position+term.length+35);
      return /(?:country of|republic of|nation of|in the country of)\s+$/u.test(before)
        ||/^\s+(?:government|parliament|president|prime minister|national election|country)\b/u.test(after);
    });
  });
}
function countryCategory(card:EvidenceCard,code:string):boolean {
  const context=contextForCard(card);
  return context.basis==='publisher-category'&&context.countries.some(country=>country.code===code);
}
function cityNames(city:City,aliases:readonly string[]):readonly string[] {
  return [...new Set([city.name,...(CITY_NAMES[city.id+':'+city.countryCode]??[]),...aliases].map(normalize).filter(value=>value.length>=2&&value.length<=200))];
}
function rejectedOccurrence(value:string,position:number,name:string,city:City):boolean {
  const after=value.slice(position+name.length,position+name.length+70);
  if(/^[\s,.'’-]*(?:times|herald|tribune|gazette|shimbun)(?:$|[^\p{L}\p{N}])/u.test(after)||/^(?:新聞|日报|日報|晚报|晚報|时报|時報|신문)/u.test(after))return true;
  if((name==='巴黎'||name==='パリ')&&/^(?:希尔顿|希爾頓|斯|ス|協定|协定|協議|协议)/u.test(after))return true;
  if((name==='纽约'||name==='紐約')&&/^(?:时报|時報|邮报|郵報|州)/u.test(after))return true;
  if(name==='paris'){
    if(/^[\s,.'’-]*(?:hilton|agreement|accord)(?:$|[^\p{L}\p{N}])/u.test(after))return true;
    if(city.countryCode==='FR'&&/^[\s,.'’()-]*(?:texas|tx|tennessee|kentucky|ontario|las vegas|united states|usa|canada)(?:$|[^\p{L}\p{N}])/u.test(after))return true;
  }
  if((name==='new york'||name==='nyc')&&city.id==='5128581'
    &&/^[\s,.'’-]*(?:post|state)(?:$|[^\p{L}\p{N}])/u.test(after))return true;
  if(name==='london'&&city.countryCode==='GB'
    &&/^[\s,.'’()-]*(?:ontario|canada|kentucky|ohio)(?:$|[^\p{L}\p{N}])/u.test(after))return true;
  return false;
}
function cityMention(text:string,city:City,aliases:readonly string[],hasCountry:boolean):boolean {
  const casePreserved=normalize(text),value=casePreserved.toLocaleLowerCase('en');
  return cityNames(city,aliases).some(spelling=>{
    const name=lower(spelling);
    return occurrences(value,name).some(position=>{
      if(rejectedOccurrence(value,position,name,city))return false;
      if(/^[A-Z.]{2,5}$/u.test(spelling)&&casePreserved.slice(position,position+spelling.length)!==spelling)return false;
      // Common verbs/adjectives must retain a proper-name spelling and civic/location wording.
      if(COMMON_CITY_WORDS.has(name)){
        if(!/\p{Lu}/u.test(casePreserved[position]??''))return false;
        const before=value.slice(Math.max(0,position-25),position),after=value.slice(position+name.length,position+name.length+40);
        return /(?:in|near|across|around|outside|dans|pres de|a)\s+$/u.test(before)
          ||/^\s+(?:city|council|mayor|residents|airport|metro|rail|transport|schools?|hospital|housing|streets?|district|police|mairie|municipalite)\b/u.test(after);
      }
      // Other catalog cities sharing these famous names need their own country/region qualifier.
      if((name==='paris'&&city.countryCode!=='FR'||name==='london'&&city.countryCode!=='GB')){
        const after=value.slice(position+name.length,position+name.length+90),region=lower(city.region);
        return hasCountry&&region.length>1&&new RegExp('^[\\s,()–—-]*(?:in\\s+)?'+escaped(region)+'(?=$|[^\\p{L}\\p{N}])','u').test(after);
      }
      return true;
    });
  });
}

/** No publisher-scope label, source URL, publisher name or attribution can supply place evidence. */
export function exploreGeography(card:EvidenceCard,city:City|null,countryCode:string|null,aliases:readonly string[]=[]):ExploreGeography|null {
  const code=city?.countryCode??countryCode;
  if(code===null)return Object.freeze({scope:'world',basis:'unfiltered',label:'All connected countries; no geographic match is inferred.'});
  const titleCountry=countryMention(card.title,code),summaryCountry=card.summary!==undefined&&countryMention(card.summary,code),category=countryCategory(card,code);
  const countryEvidence=titleCountry||summaryCountry||category;
  if(city!==null){
    if(cityMention(card.title,city,aliases,countryEvidence))return Object.freeze({scope:'city',basis:'title',label:city.name+' mentioned in the headline; event location is not independently verified.'});
    if(card.summary!==undefined&&cityMention(card.summary,city,aliases,countryEvidence))return Object.freeze({scope:'city',basis:'summary',label:'Publisher excerpt mentions '+city.name+'; event location is not independently verified.'});
  }
  const name=namesForCountry(code)[0]??code;
  if(titleCountry)return Object.freeze({scope:'country',basis:'title',label:name+' mentioned in the headline; national context, not proof of a local event.'});
  if(summaryCountry)return Object.freeze({scope:'country',basis:'summary',label:'Publisher excerpt mentions '+name+'; national context, not proof of a local event.'});
  if(category)return Object.freeze({scope:'country',basis:'publisher-category',label:name+' in publisher country categories; coverage, not verified event location.'});
  return null;
}
