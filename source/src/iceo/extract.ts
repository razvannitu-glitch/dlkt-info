import {editorialTopic} from './editorial-topics.js';
import {cardContent} from './card-validation.js';
import {contextForCard,contextFromPublisherCategories} from './context.js';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {parseDocument, DomUtils} from 'htmlparser2';
import type { EvidenceCard, Extraction, SourceDefinition } from './contracts.js';
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SOURCE_SCHEMA_INVALID');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4000): string {
  if (typeof value !== 'string') throw new Error('SOURCE_TEXT_INVALID');
  const clean = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean) || /\$\{?item\.|__\[unreferenced:[^\]]+\]__/iu.test(clean)) throw new Error('SOURCE_TEXT_INVALID');
  return clean;
}
function date(value: unknown, now: number, dayOnly = false): string {
  const raw = text(value, 100); const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed > now + (dayOnly ? 0 : 300_000) || parsed < 0) throw new Error('SOURCE_DATE_INVALID');
  const iso = new Date(parsed).toISOString();
  if (dayOnly && (!/^\d{4}-\d{2}-\d{2}$/u.test(raw) || iso.slice(0,10) !== raw)) throw new Error('SOURCE_DATE_INVALID');
  return dayOnly ? raw : iso;
}
function publicLink(value: unknown, source: SourceDefinition): string {
  const url = new URL(text(value, 3000));
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('SOURCE_LINK_REJECTED');
  if (source.adapter === 'ecb-rss' && url.hostname !== 'www.ecb.europa.eu') throw new Error('SOURCE_LINK_REJECTED');
  if (source.adapter === 'github-releases' && (url.hostname !== 'github.com' || !url.pathname.startsWith(`/${source.repo ?? ''}/releases/tag/`))) throw new Error('SOURCE_LINK_REJECTED');
  url.pathname = url.pathname.replace(/^\/+/, '/'); url.hash = '';
  return url.href;
}
function makeCard(source: SourceDefinition, now: number, values: Pick<EvidenceCard,'identity'|'title'|'sourceUrl'|'date'|'dateLabel'|'kind'|'boundary'|'deadline'|'version'|'summary'|'byline'|'licenseUrl'|'context'>): EvidenceCard {
  // A repeated headline is not an additional publisher finding. Keep the card and its identity.
  const {summary,...metadata}=values;
  const comparable=(value:string):string=>value.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('en').replace(/[.!?…]+$/u,'');
  const retained=summary!==undefined&&comparable(summary)!==comparable(values.title)?{...metadata,summary}:metadata;
  const sourceIds=Object.freeze([source.id]),context=contextForCard({...retained,sourceIds});
  const content=cardContent({...retained,context,publisher:source.publisher});
  return Object.freeze({ ...retained,context,id:hash(values.identity).slice(0,24),topic:source.topic,publisher:source.publisher,sourceIds,observedAt:new Date(now).toISOString(),contentHash:hash(content),attribution:source.attribution,sourceState:'verified' });
}
function ecb(xml: string, source: SourceDefinition, now: number): Extraction {
  if (/<!\s*(DOCTYPE|ENTITY)/iu.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('SOURCE_XML_REJECTED');
  const parsed: unknown = new XMLParser({ ignoreAttributes:false, parseTagValue:false, trimValues:true }).parse(xml);
  const channel = object(object(object(parsed).rss).channel);
  if (text(channel.title) !== 'ECB - European Central Bank') throw new Error('SOURCE_IDENTITY_MISMATCH');
  if (!Array.isArray(channel.item) && channel.item === undefined) return { cards:[], rejected:0, windowed:true };
  const items: unknown[] = Array.isArray(channel.item) ? channel.item : [channel.item];
  if (items.length > 1000) throw new Error('SOURCE_SCHEMA_INVALID');
  const cards: EvidenceCard[]=[]; let rejected=0;
  for (const item of items) { try {
    const row=object(item); const link=publicLink(row.link,source); const title=text(row.title);
    const description=typeof row.description === 'string' ? row.description : '';
    let summary:string|undefined;
    // Reuse the complete description already supplied in the permitted official feed.
    // Invalid or over-budget excerpts never remove an otherwise valid source listing.
    if(description){try{summary=feedText(description,1000);}catch{/* Listing remains available. */}}
    const match = /Closing date:\s*(\d{2})\/(\d{2})\/(\d{4})/iu.exec(description);
    let deadline:string|null=null;
    if (match) { const candidate=`${match[3]}-${match[2]}-${match[1]}`; const millis=Date.parse(candidate); if(Number.isFinite(millis)&&new Date(millis).toISOString().slice(0,10)===candidate) deadline=candidate; }
    const procurement=source.id==='ecb-procurement';
    cards.push(makeCard(source,now,{identity:link,title,sourceUrl:link,date:date(row.pubDate,now),dateLabel:'Published',kind:procurement?'procurement-notice':'publication',deadline,version:null,boundary:procurement?'Official procurement listing, not a guarantee of an open competition or eligibility. Check the notice and its deadline.':'Official publication listing, not investment advice or an independent verification of every statement in the publication.',...(summary!==undefined?{summary}:{})}));
  } catch { rejected++; } }
  return {cards,rejected,windowed:true};
}
function cellar(body: string, source: SourceDefinition, now: number): Extraction {
  const root=object(JSON.parse(body) as unknown); const bindings=object(root.results).bindings;
  if (!Array.isArray(bindings)||bindings.length>100) throw new Error('SOURCE_SCHEMA_INVALID');
  const cards:EvidenceCard[]=[]; let rejected=0;
  for (const item of bindings) { try {
    const row=object(item); const value=(key:string):unknown=>object(row[key]).value;
    const id=text(value('celex'),80);
    if(!/^[0-9A-Z][0-9]{4}[A-Z0-9()/_-]{3,60}$/u.test(id)) throw new Error('CELEX_INVALID');
    const work=new URL(text(value('work'),500));
    if(!['http:','https:'].includes(work.protocol)||work.hostname!=='publications.europa.eu'||!/^\/resource\/cellar\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(work.pathname)||work.username||work.password||work.port||work.search||work.hash) throw new Error('CELLAR_ID_INVALID');
    const lang=object(row.title)['xml:lang']; if(lang!==undefined&&lang!=='en')throw new Error('LANGUAGE_MISMATCH');
    const sourceUrl=`https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(id)}`;
    cards.push(makeCard(source,now,{identity:`celex:${id}`,title:text(value('title')),sourceUrl,date:date(value('date'),now,true),dateLabel:'Document date',kind:'legal-document',deadline:null,version:null,boundary:'Metadata observed in Cellar. Document date is not evidence of publication, entry into force, adoption today or an obligation for you.'}));
  }catch{rejected++;} }
  return {cards,rejected,windowed:true};
}
function github(body:string,source:SourceDefinition,now:number):Extraction {
  const data:unknown=JSON.parse(body); if(!Array.isArray(data)||data.length>100)throw new Error('SOURCE_SCHEMA_INVALID');
  const cards:EvidenceCard[]=[];let rejected=0;
  for(const item of data){try{
    const row=object(item);
    if(typeof row.draft!=='boolean'||typeof row.prerelease!=='boolean')throw new Error('RELEASE_SCHEMA_INVALID');
    if(row.draft||row.prerelease)continue;
    const tag=text(row.tag_name,100); if(!/^v?\d+\.\d+\.\d+$/u.test(tag))continue;
    const link=publicLink(row.html_url,source);
    if(decodeURIComponent(new URL(link).pathname.split('/').at(-1)??'')!==tag)throw new Error('RELEASE_ID_MISMATCH');
    const name=typeof row.name==='string'&&row.name.trim()?text(row.name):tag;
    cards.push(makeCard(source,now,{identity:link,title:`${source.id==='nextjs'?'Next.js':'Node.js'} · ${name}`,sourceUrl:link,date:date(row.published_at,now),dateLabel:'Published',kind:'software-release',version:tag,deadline:null,boundary:'A published non-prerelease version in the official repository. Review the release notes and compatibility before upgrading; installation is never automatic.'}));
  }catch{rejected++;}}
  return {cards,rejected,windowed:true};
}
/** Discard executable markup, keeping a complete publisher excerpt within the public field budget. */
function feedText(value: unknown, maximum: number): string {
  const raw=text(value,20000);
  const document=parseDocument(raw,{decodeEntities:true});
  for(const node of DomUtils.findAll(n=>['script','style','iframe','object','template'].includes(n.name),document.children))DomUtils.removeElement(node);
  return text(DomUtils.textContent(document),maximum);
}
function feedLink(value:unknown,source:SourceDefinition,home=false):string {
  const config=source.feed;if(!config)throw new Error('SOURCE_FEED_CONFIG_INVALID');
  const raw=text(value,3000);
  // Decode escaped ampersands without allowing the HTML parser to rewrite a URL's path.
  if(/[<>]/u.test(raw))throw new Error('SOURCE_LINK_REJECTED');
  const decoded=DomUtils.textContent(parseDocument(raw,{decodeEntities:true}));
  if(/[<>\s\\\u0000-\u001f\u007f]/u.test(decoded))throw new Error('SOURCE_LINK_REJECTED');
  const url=new URL(decoded);
  if(url.username||url.password||url.port)throw new Error('SOURCE_LINK_REJECTED');
  if(url.protocol==='http:'&&config.allowHttpLinks&&url.hostname===new URL(config.homeOrigin).hostname)url.protocol='https:';
  if(url.protocol!=='https:'||!(home?[config.homeOrigin]:config.articleOrigins).includes(url.origin))throw new Error('SOURCE_LINK_REJECTED');
  if(home){if(config.homeUrl?url.href!==config.homeUrl:url.pathname!==(config.homePath??'/')||Boolean(url.search)||Boolean(url.hash))throw new Error('SOURCE_IDENTITY_MISMATCH');}
  else{
    if(!config.articlePaths.some(prefix=>url.pathname.startsWith(prefix)))throw new Error('SOURCE_LINK_REJECTED');
    for(const key of url.searchParams.keys())if(!config.trackingQueryKeys?.includes(key))throw new Error('SOURCE_LINK_REJECTED');
    url.search='';url.hash='';
  }
  return url.href;
}
function atomLink(value:unknown):string {
  const links:unknown[]=Array.isArray(value)?value:[value];
  const selected=links.map(object).filter(link=>link['@_rel']==='alternate'&&link['@_type']==='text/html');
  if(selected.length!==1)throw new Error('SOURCE_LINK_REJECTED');
  return text(selected[0]?.['@_href'],3000);
}
function feedCredits(row:Record<string,unknown>,source:SourceDefinition):{readonly byline:string;readonly licenseUrl:string}|null {
 const config=source.feed;if(!config?.credits)return null;
 const licenseUrl=config.licenseUrl;if(!licenseUrl||!['https://creativecommons.org/licenses/by/3.0/','https://creativecommons.org/licenses/by/4.0/'].includes(licenseUrl))throw Error('SOURCE_LICENSE_INVALID');
 if(config.credits==='publisher')return {byline:source.publisher,licenseUrl};
 if(config.credits==='creator')return {byline:'By '+feedText(row['dc:creator'],590),licenseUrl};
 const raw=text(row['content:encoded'],2_097_152);const document=parseDocument(raw,{decodeEntities:true});
 const hasClass=(node:{readonly attribs?:Record<string,string>},name:string):boolean=>(node.attribs?.class??'').split(/\s+/u).includes(name);
 const footers=DomUtils.findAll(n=>hasClass(n,'gv-rss-footer'),document.children);if(footers.length!==1)throw Error('SOURCE_CREDITS_INVALID');
 const sections=DomUtils.findAll(n=>hasClass(n,'text-credits-section'),footers[0]?.children??[]);
 if(sections.length===0||sections.length>6)throw Error('SOURCE_CREDITS_INVALID');
 let written=false;const parts=sections.map(section=>{
  const labels=DomUtils.findAll(n=>hasClass(n,'credit-label'),section.children),names=DomUtils.findAll(n=>hasClass(n,'user-link'),section.children);
  if(labels.length!==1||names.length!==1)throw Error('SOURCE_CREDITS_INVALID');
  const labelNode=labels[0],nameNode=names[0];if(!labelNode||!nameNode)throw Error('SOURCE_CREDITS_INVALID');
  const label=text(DomUtils.textContent(labelNode),80),name=text(DomUtils.textContent(nameNode),200);
  if(!/^(Written|Translated)(?: \([^()]+\))? by$/u.test(label))throw Error('SOURCE_CREDITS_INVALID');
  if(label.startsWith('Written'))written=true;return label+' '+name;
 });
 if(!written)throw Error('SOURCE_CREDITS_INVALID');return{byline:text(parts.join(' · '),600),licenseUrl};
}
function reviewedFeed(body:string,source:SourceDefinition,now:number):Extraction {
  const config=source.feed;
  if(!config||!Number.isFinite(now)||body.length>2_097_152)throw new Error('SOURCE_FEED_CONFIG_INVALID');
  if(/<!\s*(DOCTYPE|ENTITY)/iu.test(body)||XMLValidator.validate(body)!==true)throw new Error('SOURCE_XML_REJECTED');
  const parsed:unknown=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:true}).parse(body);
  const root=object(parsed),channel=config.format==='rss'?object(object(root.rss).channel):object(root.feed);
  if(config.format==='atom'&&channel['@_xmlns']!=='http://www.w3.org/2005/Atom')throw new Error('SOURCE_IDENTITY_MISMATCH');
  if(feedText(channel.title,300)!==config.title)throw new Error('SOURCE_IDENTITY_MISMATCH');
  feedLink(config.format==='rss'?channel.link:atomLink(channel.link),source,true);
  const values=config.format==='rss'?channel.item:channel.entry;
  const items:unknown[]=values===undefined?[]:Array.isArray(values)?values:[values];
  if(items.length>200)throw new Error('SOURCE_SCHEMA_INVALID');
  const cards:EvidenceCard[]=[];let rejected=0;
  for(const item of items){try{
    const row=object(item),rawDate=text(row[config.dateField],100);
    if(config.format==='rss'&&config.requireDateTimezone&&!/\d{1,2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC|[+-]\d{4})$/u.test(rawDate))throw new Error('SOURCE_DATE_INVALID');
    if(config.format==='atom'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(rawDate))throw new Error('SOURCE_DATE_INVALID');
    const published=date(rawDate,now);
    if(Date.parse(published)<now-config.windowDays*86_400_000)continue;
    const categories:unknown[]=Array.isArray(row.category)?row.category:row.category===undefined?[]:[row.category];
    if(config.excludeCategories?.some(label=>categories.some(category=>typeof category==='string'&&feedText(category,200)===label)))continue;
    const credits=feedCredits(row,source);
    const countryTags=categories.flatMap(category=>{
      if(typeof category==='string')return [category];
      if(category!==null&&typeof category==='object'&&!Array.isArray(category)){
        const entry=category as Record<string,unknown>,value=entry['#text'];
        if(Object.keys(entry).every(key=>key==='#text'||key.startsWith('@_'))&&typeof value==='string')return [value];
      }
      return [];
    });
    const context=contextFromPublisherCategories(source.id,countryTags);
    let titleValue:unknown=row.title,linkValue:unknown=config.format==='rss'?row.link:atomLink(row.link);
    // FTC's reviewed feed nests the canonical link inside its title element.
    if(source.id==='ftc-consumer'&&typeof row.title!=='string'){
      const wrapper=object(row.title);if(Object.keys(wrapper).join(',')!=='a')throw Error('SOURCE_SCHEMA_INVALID');
      const anchor=object(wrapper.a);if(Object.keys(anchor).some(key=>!['#text','@_href','@_hreflang'].includes(key)))throw Error('SOURCE_SCHEMA_INVALID');
      if(anchor['@_hreflang']!==undefined&&anchor['@_hreflang']!=='en')throw Error('SOURCE_SCHEMA_INVALID');
      titleValue=anchor['#text'];linkValue=anchor['@_href'];
    }
    const sourceUrl=feedLink(linkValue,source);
    let summary:string|undefined;
    // Long or missing descriptions retain their listing; they are never cut mid-qualification.
    if(row[config.summary]!==undefined){try{
      const value=row[config.summary];
      if(config.format==='atom'&&typeof value!=='string'){
        const entry=object(value);
        if(entry['@_type']==='html')summary=feedText(entry['#text'],1000);
        else if(entry['@_type']===undefined||entry['@_type']==='text')summary=text(entry['#text'],1000);
      }else if(config.summaryMode==='first-paragraph'&&typeof value==='string'){
       const document=parseDocument(value,{decodeEntities:true});
       const paragraph=DomUtils.findOne(node=>node.name==='p',document.children);
       if(paragraph)summary=feedText(DomUtils.getOuterHTML(paragraph),1000);
      }else summary=feedText(value,1000);
    }catch{/* Headline and source remain available. */}}
    const title=feedText(titleValue,4000);
    const card=makeCard(source,now,{identity:sourceUrl,title,sourceUrl,date:published,dateLabel:config.dateLabel,
      kind:'publication',deadline:null,version:null,boundary:config.boundary,...(summary!==undefined?{summary}:{}),...(credits??{}),...(context!==undefined?{context}:{})});
    cards.push(Object.freeze({...card,topic:editorialTopic(source.id,source.topic,title,countryTags)}));
  }catch{rejected++;}}
  return{cards,rejected,windowed:true};
}
export function extract(body:string,source:SourceDefinition,now:number):Extraction {
  return source.adapter==='ecb-rss'?ecb(body,source,now):source.adapter==='cellar-sparql'?cellar(body,source,now):source.adapter==='reviewed-feed'?reviewedFeed(body,source,now):github(body,source,now);
}
