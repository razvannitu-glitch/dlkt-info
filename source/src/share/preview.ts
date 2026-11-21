import {TOPIC_LABELS} from '../iceo/topics.js';
import {cardLink} from './link.js';
import {publisherExcerpt} from './content.js';
import type {EvidenceCard} from '../iceo/contracts.js';
export const IMAGE_WIDTH=1200,IMAGE_HEIGHT=630;
export const OGL='https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
export interface PreviewPlan {readonly generic:boolean;readonly title:string;readonly excerpt:string;readonly publisher:string;readonly byline:string;readonly license:string;readonly original:string;readonly topic:string;readonly date:string;readonly checked:string;readonly cardUrl:string;readonly tone:0|1|2}
/** Only ASCII text enters the bundled font renderer; unsupported names keep their exact credits on HTML. */
function plain(value:string):string|null {
 const normalized=value.replace(/[\u2018\u2019]/gu,"'").replace(/[\u201c\u201d]/gu,'"').replace(/[\u2013\u2014]/gu,'-').replace(/\u2026/gu,'...').replace(/\u00a0/gu,' ');
 return /^[\x20-\x7e]*$/u.test(normalized)?normalized:null;
}
export function previewPlan(card:EvidenceCard):PreviewPlan {
 const title=plain(card.title),publisher=plain(card.publisher),byline=plain(card.byline??'');
 // Conservative worst-case ASCII widths, including word wrapping. Full credits and title
 // share the same vertical budget; unsupported or crowded metadata uses a generic image.
 const lines=(value:string,width:number):number=>{let n=1,used=0;for(const word of value.split(' ')){if(word.length>width)return Infinity;if(used&&used+1+word.length>width){n++;used=word.length;}else used+=word.length+(used?1:0);}return n;};
 const titleSize=title!==null&&title.length>145?40:48;
 const height=title===null||publisher===null||byline===null?Infinity:lines(title,Math.floor(1070/titleSize))*titleSize*1.18+lines(publisher,53)*26+Math.ceil(card.sourceUrl.length/70)*19.5+(byline?lines(byline,66)*20.8:0)+14;
 const generic=title===null||title.length>210||publisher===null||publisher.length>80||byline===null||byline.length>180||card.sourceUrl.length>170||height>300;
 const fullExcerpt=plain(publisherExcerpt(card)??'');
 // Keep the complete excerpt, including conditions, or leave it to the linked HTML page.
 const excerpt=!generic&&fullExcerpt!==null&&fullExcerpt.length<=260&&height+lines(fullExcerpt,48)*26+12<=300?fullExcerpt:'';
 const license=card.licenseUrl?`${card.licenseUrl.includes('/3.0/')?'CC BY 3.0':'CC BY 4.0'} - ${card.licenseUrl}`:card.sourceIds.some(id=>['govuk-news','govuk-products','ncsc-news'].includes(id))?`Contains public sector information licensed under OGL v3.0. ${OGL}`:'';
 return {generic,title:generic?'Open this card for the original title and source.':title,excerpt,publisher:publisher!==null&&publisher.length<=80?publisher:'Connected publisher',byline:generic?'':byline,license:generic?'':license,original:generic?'':card.sourceUrl,topic:plain(TOPIC_LABELS[card.topic])??'Source update',date:`${card.dateLabel}: ${card.date.slice(0,10)}`,checked:`Source checked: ${card.observedAt.slice(0,16).replace('T',' ')} UTC`,cardUrl:cardLink(card),tone:(Number.parseInt(card.id.slice(0,2),16)%3) as 0|1|2};
}
export function previewAlt(card:EvidenceCard):string {return `DLKT source-dated ${TOPIC_LABELS[card.topic]} preview. Open the card for the original title, source and complete credits.`;}
