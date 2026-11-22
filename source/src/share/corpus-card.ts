import type {IceoSnapshot} from '../iceo/contracts.js';
import {createNewsCorpusStore,type NewsCorpusStore} from '../iceo/news-corpus-store.js';
import {validNewsGlobalCard} from '../iceo/news-page-contracts.js';
import {validArchiveCard} from './archive.js';
import {currentCard,type CurrentCard} from './current-card.js';
import type {CardReference} from './link.js';

/** Exact verified versions outside the compatibility snapshot remain shareable. No URL is supplied by a reader. */
export async function resolveCurrentCard(
 load:()=>Promise<IceoSnapshot>,reference:CardReference,clock:()=>number,exactRevision=false,
 corpus:Pick<NewsCorpusStore,'lookup'>|null=createNewsCorpusStore(process.env),
):Promise<CurrentCard>{
 if(corpus&&reference.revision!==null){
  try{
   const item=await corpus.lookup({id:reference.id,revision:reference.revision}),now=clock();
   if(item?.kind==='global'&&item.card.id===reference.id&&item.card.contentHash===reference.revision
    &&validArchiveCard(item.card)&&validNewsGlobalCard(item.card,now)){
    const validUntil=Math.min(Date.parse(item.card.observedAt)+3_600_000,Date.parse(item.card.date)+86_400_000);
    if(validUntil>now)return {card:item.card,validUntil,partial:item.card.sourceState==='partial'};
   }
  }catch{/* The independently validated compatibility snapshot can still serve its own record. */}
 }
 return currentCard(await load(),reference,clock(),exactRevision);
}
