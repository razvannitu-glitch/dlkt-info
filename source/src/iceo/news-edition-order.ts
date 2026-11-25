import type {GeoFeedBand} from './geo-balance.js';

interface Candidate<T> {readonly item:T;readonly position:number;readonly category:string;readonly publisher:string;readonly band:GeoFeedBand}
interface PublisherQueue<T> {readonly items:Candidate<T>[];offset:number;served:number}
interface CategoryQueue<T> {readonly publishers:Map<string,PublisherQueue<T>>;remaining:number}

const BAND_ORDER=['local','national','international'] as const;

/**
 * Order one already eligible, grouped edition before filtering or pagination.
 * Complete each geographic band before starting the next. Category cycles and
 * publisher exposure are independent within each band. Original order remains
 * intact inside each category/publisher/band queue, and every item is retained.
 */
export function balanceNewsEdition<T>(
 items:readonly T[],category:(item:T)=>string,publisher:(item:T)=>string,band:(item:T)=>GeoFeedBand,
):readonly T[] {
 if(!Array.isArray(items)||items.length>5000)throw Error('NEWS_EDITION_ORDER_INPUT_INVALID');
 const bands=new Map<GeoFeedBand,Candidate<T>[]>();
 for(const scope of BAND_ORDER)bands.set(scope,[]);
 // Partition first: an earlier international record cannot hide a local
 // record from the same normalized publisher and category.
 for(const [position,item]of items.entries()){
  const subject=category(item),label=publisher(item),scope=band(item);
  if(typeof subject!=='string'||!subject.trim()||typeof label!=='string'||!label.trim())throw Error('NEWS_EDITION_ORDER_IDENTITY_INVALID');
  if(scope!=='local'&&scope!=='national'&&scope!=='international')throw Error('NEWS_EDITION_ORDER_SCOPE_INVALID');
  const owner=label.normalize('NFKC').trim().toLowerCase();
  bands.get(scope)!.push({item,position,category:subject,publisher:owner,band:scope});
 }
 const result:T[]=[];
 let previousCategory:string|null=null,previousPublisher:string|null=null;
 for(const scope of BAND_ORDER){
  const bandItems=bands.get(scope)!;
  const queues=new Map<string,CategoryQueue<T>>(),exposure=new Map<string,number>();
  for(const entry of bandItems){
   const group=queues.get(entry.category)??{publishers:new Map<string,PublisherQueue<T>>(),remaining:0};
   const queue:PublisherQueue<T>=group.publishers.get(entry.publisher)??{items:[],offset:0,served:0};
   queue.items.push(entry);group.publishers.set(entry.publisher,queue);group.remaining++;queues.set(entry.category,group);
  }
  const heads=(active:ReadonlySet<string>):Candidate<T>[]=>{
   const rows:Candidate<T>[]=[];
   for(const subject of active)for(const queue of queues.get(subject)!.publishers.values()){
    const entry=queue.items[queue.offset];if(entry!==undefined)rows.push(entry);
   }
   return rows;
  };
  const pending=new Set(queues.keys());
  let served=0;
  const take=(entry:Candidate<T>):void=>{
   const group=queues.get(entry.category)!,queue=group.publishers.get(entry.publisher)!;
   queue.offset++;queue.served++;group.remaining--;pending.delete(entry.category);
   exposure.set(entry.publisher,(exposure.get(entry.publisher)??0)+1);
   previousCategory=entry.category;previousPublisher=entry.publisher;result.push(entry.item);served++;
  };
  while(served<bandItems.length){
   if(pending.size===0)for(const [subject,group]of queues)if(group.remaining>0)pending.add(subject);
   let candidates=heads(pending);
   const differentCategory=candidates.filter(entry=>entry.category!==previousCategory);
   if(differentCategory.length)candidates=differentCategory;
   const differentPublisher=candidates.filter(entry=>entry.publisher!==previousPublisher);
   if(differentPublisher.length)candidates=differentPublisher;
   candidates.sort((a,b)=>(exposure.get(a.publisher)??0)-(exposure.get(b.publisher)??0)
    ||queues.get(a.category)!.publishers.get(a.publisher)!.served-queues.get(b.category)!.publishers.get(b.publisher)!.served
    ||a.position-b.position);
   const selected=candidates[0];if(selected===undefined)throw Error('NEWS_EDITION_ORDER_EXHAUSTED');
   take(selected);
  }
 }
 return Object.freeze(result);
}
