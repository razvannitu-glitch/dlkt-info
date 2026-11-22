import type {ArticleSubjectMetadata} from './contracts.js';

const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function terms(value:unknown,maximum:number):value is readonly string[]{
  return Array.isArray(value)&&value.length<=maximum&&value.every((term,index)=>typeof term==='string'
    &&term.length>0&&term.length<=80&&!/[<>\\u0000-\\u001f\\u007f]/u.test(term)
    &&term===term.normalize('NFC').replace(/\\s+/gu,' ').trim()
    &&(index===0||typeof value[index-1]==='string'&&value[index-1]<term));
}
/** The binding is publication evidence; neither a title guess nor another page's tags may supply it. */
export function validArticleSubject(value:unknown,sourceUrl:unknown):value is ArticleSubjectMetadata {
  return record(value)&&Object.keys(value).length===4&&value.basis==='publisher-jsonld'
    &&typeof sourceUrl==='string'&&value.articleUrl===sourceUrl&&terms(value.sections,8)&&terms(value.keywords,12)
    &&value.sections.length+value.keywords.length>0;
}
export function copyArticleSubject(value:ArticleSubjectMetadata):ArticleSubjectMetadata {
  return {basis:'publisher-jsonld',articleUrl:value.articleUrl,sections:[...value.sections],keywords:[...value.keywords]};
}
