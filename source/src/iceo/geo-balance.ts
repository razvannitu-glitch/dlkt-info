/**
 * A deterministic reading-order projection. Only city-confirmed reports qualify
 * as local. Publisher-country provenance is national scope, never proof that an
 * event occurred in the reader's region, street or neighborhood.
 */
export type GeoFeedBand='local'|'national'|'international';
const slots:readonly GeoFeedBand[]=['local','local','local','national','national','international'];
export function balanceGeoBands<T>(items:readonly T[],band:(item:T)=>GeoFeedBand):readonly T[] {
 if(!Array.isArray(items)||items.length>5000)throw Error('GEO_FEED_INPUT_INVALID');
 const queues:Record<GeoFeedBand,T[]>={local:[],national:[],international:[]};
 for(const item of items){
  const scope=band(item);
  if(scope!=='local'&&scope!=='national'&&scope!=='international')throw Error('GEO_FEED_SCOPE_INVALID');
  queues[scope].push(item);
 }
 const positions:Record<GeoFeedBand,number>={local:0,national:0,international:0};
 const result:T[]=[];
 while(result.length<items.length){
  let added=0;
  for(const scope of slots){
   const next=queues[scope][positions[scope]];
   if(next!==undefined){result.push(next);positions[scope]++;added++;}
  }
  if(!added)throw Error('GEO_FEED_EXHAUSTED');
 }
 return Object.freeze(result);
}

/** Preserve the existing one-item-per-category reading rounds while preferring
 * verified local evidence inside each round. A change of geography cannot
 * delete a category, duplicate a report, or starve other countries.
 */
export function balanceGeoCategoryRounds<T>(
 items:readonly T[],category:(item:T)=>string,band:(item:T)=>GeoFeedBand,
):readonly T[] {
 if(!Array.isArray(items)||items.length>5000)throw Error('GEO_ROUNDS_INPUT_INVALID');
 const remaining=new Map<string,number>();
 for(const item of items){
  const key=category(item);if(typeof key!=='string'||!key)throw Error('GEO_CATEGORY_INVALID');
  remaining.set(key,(remaining.get(key)??0)+1);
 }
 const result:T[]=[];let cursor=0,previous:string|null=null;
 while(cursor<items.length){
  const active=[...remaining].filter(([,count])=>count>0).map(([key])=>key);
  const slice=items.slice(cursor,cursor+active.length);
  if(slice.length!==active.length||new Set(slice.map(category)).size!==active.length||
     active.some(key=>!slice.some(item=>category(item)===key)))throw Error('GEO_CATEGORY_ROUNDS_INVALID');
  const ordered=[...balanceGeoBands(slice,band)];
  if(previous!==null&&ordered.length>1&&category(ordered[0]!)===previous){
   const alternative=ordered.findIndex(item=>category(item)!==previous);
   if(alternative>0){const [moved]=ordered.splice(alternative,1);if(moved)ordered.unshift(moved);}
  }
  result.push(...ordered);previous=category(ordered[ordered.length-1]!);
  for(const key of active)remaining.set(key,(remaining.get(key)??0)-1);
  cursor+=slice.length;
 }
 return Object.freeze(result);
}
