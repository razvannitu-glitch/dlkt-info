import {safeLink} from './source-links.js';
export {safeLink} from './source-links.js';
import {validCredits} from './credits.js';
import {validArticleSubject,copyArticleSubject} from './article-subject.js';
import {PUBLIC_TOPICS} from './topics.js';
import {validContextForCard} from './context.js';
import type {EvidenceCard,Topic} from './contracts.js';
const TOPICS = PUBLIC_TOPICS;
/** Exact canonical field order shared by extraction and public-card integrity checks. */
export function cardContent(card:Pick<EvidenceCard,'identity'|'title'|'sourceUrl'|'date'|'dateLabel'|'publisher'|'deadline'|'version'|'summary'|'byline'|'licenseUrl'|'context'|'articleSubject'>){
  return {identity:card.identity,title:card.title,sourceUrl:card.sourceUrl,date:card.date,dateLabel:card.dateLabel,publisher:card.publisher,deadline:card.deadline,version:card.version,
    ...(card.summary!==undefined?{summary:card.summary}:{}),...(card.byline!==undefined?{byline:card.byline,licenseUrl:card.licenseUrl}:{}),
    ...(card.context!==undefined?{context:{countries:card.context.countries.map(country=>({code:country.code,name:country.name})),basis:card.context.basis,label:card.context.label,boundary:card.context.boundary}}:{}),...(card.articleSubject!==undefined?{articleSubject:copyArticleSubject(card.articleSubject)}:{})};
}
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function string(value:unknown,max=4000):value is string{return typeof value==='string'&&value.length<=max;}
function stamp(value:unknown):value is string{return string(value,100)&&Number.isFinite(Date.parse(value));}

export function validCard(value:unknown):value is EvidenceCard {
  return object(value)&&validCredits(value)&&string(value.id,24)&&/^[a-f0-9]{24}$/u.test(value.id)&&string(value.identity,3000)
    &&string(value.title)&&value.title.length>0&&TOPICS.includes(value.topic as Topic)
    &&['publication','legal-document','software-release','procurement-notice'].includes(String(value.kind))
    &&safeLink(value.sourceUrl)!==null&&stamp(value.date)&&stamp(value.observedAt)
    &&['Published','Document date','Updated'].includes(String(value.dateLabel))&&string(value.publisher,300)
    &&(value.summary===undefined||string(value.summary,1000)&&value.summary.length>0)&&string(value.boundary)&&string(value.attribution)&&Array.isArray(value.sourceIds)&&value.sourceIds.every(id=>string(id,80))
    &&(value.context===undefined||validContextForCard(value.context,value.sourceIds as string[]))
    &&(value.articleSubject===undefined||value.kind==='publication'&&validArticleSubject(value.articleSubject,value.sourceUrl))
    &&['verified','partial','stale'].includes(String(value.sourceState))&&string(value.contentHash,64)&&/^[a-f0-9]{64}$/u.test(value.contentHash)
    &&(value.version===null||string(value.version,100))&&(value.deadline===null||stamp(value.deadline));
}

export function copyCard(card:EvidenceCard):EvidenceCard{
  if(!validCard(card))throw new Error('MEMORY_CARD_INVALID');
  return {id:card.id,identity:card.identity,title:card.title,topic:card.topic,kind:card.kind,sourceUrl:card.sourceUrl,
    publisher:card.publisher,sourceIds:[...card.sourceIds],date:card.date,dateLabel:card.dateLabel,
    observedAt:card.observedAt,contentHash:card.contentHash,boundary:card.boundary,deadline:card.deadline,
    version:card.version,attribution:card.attribution,sourceState:card.sourceState,...(card.summary!==undefined?{summary:card.summary}:{}),...(card.byline!==undefined?{byline:card.byline,licenseUrl:card.licenseUrl}:{}),
    ...(card.context!==undefined?{context:{countries:card.context.countries.map(country=>({code:country.code,name:country.name})),basis:card.context.basis,label:card.context.label,boundary:card.context.boundary}}:{}),...(card.articleSubject!==undefined?{articleSubject:copyArticleSubject(card.articleSubject)}:{})};
}
