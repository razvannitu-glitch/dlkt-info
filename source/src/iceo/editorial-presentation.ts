import {cardGuide} from './card-guide.js';
import {contextForCard} from './context.js';
import {sourcePublicationContext} from './news-sources.js';
import type {EvidenceCard} from './contracts.js';
import type {ReadingCard} from './reader.js';
import type {PublicEditionState} from './home-edition.js';

export interface EditorialCardPresentation {
 readonly headline:string;
 readonly kindLabel:string;
 readonly visibleContext:string|null;
 readonly detailContext:string|null;
 readonly safetyNote:string|null;
 readonly originalTitleInDetails:boolean;
}

export interface EditorialSourceContext {
 readonly editionLanguage:string|null;
 readonly publisherCountry:Readonly<{code:string;name:string}>|null;
 readonly coverage:Readonly<{basis:'publisher-category'|'publisher-scope';countries:readonly Readonly<{code:string;name:string}>[]}>|null;
}
/** Provenance, never a guessed event location, article translation or personal impact. */
export function editorialSourceContext(card:EvidenceCard):EditorialSourceContext {
 const publication=sourcePublicationContext(card),context=contextForCard(card);
 return Object.freeze({
  editionLanguage:publication?.language??null,
  publisherCountry:publication?Object.freeze({code:publication.publisherCountryCode,name:publication.publisherCountryName}):null,
  coverage:context.basis!=='unspecified'&&context.countries.length?Object.freeze({basis:context.basis,countries:context.countries}):null,
 });
}

/** Condense ordinary reading copy without hiding a status that changes its meaning. */
export function editorialCardPresentation(view:ReadingCard,savedCopy=false):EditorialCardPresentation {
 const card=view.card,publication=card.kind==='publication';
 const headline=publication?card.title:view.heading;
 const kind=publication?(card.summary?'From the publisher':''):view.label;
 const kindLabel=[savedCopy?'Saved copy':'',kind,card.sourceState==='stale'?'Older source check':''].filter(Boolean).join(' · ');
 const criticalSource=publication&&card.sourceIds.some(id=>['govuk-products','ncsc-news','fda-news'].includes(id));
 const guide=criticalSource?cardGuide(card):null;
 return Object.freeze({
  headline,kindLabel,
  visibleContext:publication?card.summary??null:view.context,
  detailContext:publication&&card.summary===undefined?view.context:null,
  safetyNote:guide?`${guide.scope}. ${guide.nextStep}`:null,
  originalTitleInDetails:view.shortened&&headline!==card.title,
 });
}

export interface EditionStatusInput {
 readonly state:PublicEditionState;
 readonly count:number;
 readonly continuation:number;
 readonly checkedTime:string|null;
 readonly refreshing:boolean;
 readonly refreshFailed:boolean;
 readonly partial:boolean;
 readonly updates:number;
}

/** "Checked" refers to source acquisition, never to an assertion that a story is true. */
export function compactEditionStatus(input:EditionStatusInput):string {
 if(input.state==='unavailable')return 'Stories could not be checked. Refresh to try again.';
 if(input.state==='pending'&&input.count+input.continuation===0)return 'Loading today’s stories…';
 if(input.state==='empty')return 'No current stories match this selection. Coverage is incomplete.';
 const count=input.count?`${input.count} ${input.count===1?'story':'stories'}`:`${input.continuation} current ${input.continuation===1?'story':'stories'} below`;
 const parts=[count];
 if(input.checkedTime)parts.push(`Checked ${input.checkedTime}`);
 if(input.refreshFailed)parts.push('Refresh unavailable — showing the previous check');
 else if(input.refreshing)parts.push('Checking for updates…');
 if(input.partial)parts.push('Partial coverage');
 if(input.updates)parts.push(`${input.updates} ${input.updates===1?'update':'updates'} available`);
 return parts.join(' · ');
}
