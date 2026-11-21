import {referencePlaces,BUCHAREST_REFERENCES} from './reference-places.js';
import type {LocalSourceCache} from './source-cache.js';
import {object,finite,stamp,validCity,type City} from './contracts.js';

export type PlaceCategory='food'|'culture'|'outdoors';
export interface LocalPlace {readonly source:'osm'|'wikidata';readonly id:string;readonly name:string;readonly category:PlaceCategory;readonly type:string;readonly lat:number;readonly lon:number;readonly address:string|null;readonly sourceUrl:string}
export interface CityPlaces {readonly state:'ready'|'reference'|'unavailable';readonly checkedAt:string|null;readonly validTo:string|null;readonly dataAsOf:string|null;readonly items:readonly LocalPlace[]}
const values:Readonly<Record<string,PlaceCategory>>={restaurant:'food',cafe:'food',bar:'food',museum:'culture',gallery:'culture',park:'outdoors'};
export function placesUrl(city:City):string {
 if(!validCity(city))throw Error('PLACE_CITY_INVALID');
 const query=`[out:json][timeout:6];nwr(around:2500,${city.lat.toFixed(4)},${city.lon.toFixed(4)})[~"^(amenity|tourism|leisure)$"~"^(restaurant|cafe|bar|museum|gallery|park)$"][name];out tags center 30;`;
 return 'https://overpass.private.coffee/api/interpreter?data='+encodeURIComponent(query);
}
export function allowedPlacesQuery(url:URL):boolean {
 return url.origin==='https://overpass.private.coffee'&&url.pathname==='/api/interpreter'&&!url.hash&&[...url.searchParams].length===1&&/^\[out:json\]\[timeout:6\];nwr\(around:2500,-?\d{1,2}\.\d{4},-?\d{1,3}\.\d{4}\)\[~"\^\(amenity\|tourism\|leisure\)\$"~"\^\(restaurant\|cafe\|bar\|museum\|gallery\|park\)\$"\]\[name\];out tags center 30;$/u.test(url.searchParams.get('data')??'');
}
const clean=(value:unknown,max=160):string|null=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\p{Surrogate}\p{Cc}<>]/u.test(value)?value.trim():null;
function distance(city:City,lat:number,lon:number):number {const rad=Math.PI/180,a=Math.sin((lat-city.lat)*rad/2)**2+Math.cos(city.lat*rad)*Math.cos(lat*rad)*Math.sin((lon-city.lon)*rad/2)**2;return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));}
export function placesSourceError(value:unknown):boolean{return !object(value)||value.remark!==undefined&&(typeof value.remark!=='string'||value.remark.trim().length>0)||value.error!==undefined||value.errors!==undefined;}
export function parsePlaces(value:unknown,city:City,checkedAt:string,now:number):CityPlaces {
 if(placesSourceError(value)||!object(value)||!object(value.osm3s)||!stamp(value.osm3s.timestamp_osm_base)||Date.parse(value.osm3s.timestamp_osm_base)>now+300000||Date.parse(value.osm3s.timestamp_osm_base)<now-7*86400000||!Array.isArray(value.elements)||value.elements.length>30||!stamp(checkedAt)||Date.parse(checkedAt)>now+5000||Date.parse(checkedAt)<now-86400000)throw Error('PLACES_DATA_INVALID');
 const items:LocalPlace[]=[],ids=new Set<string>();
 for(const element of value.elements){
  if(!object(element)||!['node','way','relation'].includes(String(element.type))||!Number.isSafeInteger(element.id)||Number(element.id)<=0||!object(element.tags))continue;
  const position=element.type==='node'?element:element.center;if(!object(position)||!finite(position.lat,-90,90)||!finite(position.lon,-180,180)||distance(city,position.lat,position.lon)>3500)continue;
  const tags=element.tags,name=clean(tags.name);const type=[tags.amenity,tags.tourism,tags.leisure].find((t):t is string=>typeof t==='string'&&Object.hasOwn(values,t));if(!name||!type)continue;
  const id=`${element.type}/${element.id}`;if(ids.has(id))continue;ids.add(id);
  const street=clean(tags['addr:street']),number=clean(tags['addr:housenumber'],20);
  items.push({source:'osm',id,name,category:values[type] as PlaceCategory,type,lat:position.lat,lon:position.lon,address:street?`${street}${number?' '+number:''}`:null,sourceUrl:'https://www.openstreetmap.org/'+id});
 }
 const mixed:LocalPlace[]=[];for(let i=0;i<2;i++)for(const category of ['food','culture','outdoors'] as const){const item=items.filter(p=>p.category===category)[i];if(item)mixed.push(item);}
 return{state:'ready',checkedAt,validTo:new Date(Date.parse(checkedAt)+86400000).toISOString(),dataAsOf:value.osm3s.timestamp_osm_base,items:mixed};
}
export function validCityPlaces(value:unknown,city:City,now:number):value is CityPlaces {
 if(!object(value)||!['ready','reference','unavailable'].includes(String(value.state))||!Array.isArray(value.items)||value.items.length>6)return false;
 if(value.state==='reference')return city.id==='683506'&&value.checkedAt===null&&value.validTo===null&&value.dataAsOf==='2026-11-17T00:00:00.000Z'&&JSON.stringify(value.items)===JSON.stringify(BUCHAREST_REFERENCES);
 if(value.state==='unavailable')return value.checkedAt===null&&value.validTo===null&&value.dataAsOf===null&&value.items.length===0;
 if(!stamp(value.checkedAt)||Date.parse(value.checkedAt)>now+5000||Date.parse(value.checkedAt)<now-86400000||!stamp(value.validTo)||Date.parse(value.validTo)!==Date.parse(value.checkedAt)+86400000||Date.parse(value.validTo)<=now||!stamp(value.dataAsOf)||Date.parse(value.dataAsOf)>Date.parse(value.checkedAt)+300000||Date.parse(value.dataAsOf)<Date.parse(value.checkedAt)-7*86400000)return false;
 return new Set(value.items.map(p=>object(p)?p.id:null)).size===value.items.length&&value.items.every(p=>object(p)&&p.source==='osm'&&typeof p.id==='string'&&/^(node|way|relation)\/[1-9]\d{0,15}$/u.test(p.id)&&p.sourceUrl==='https://www.openstreetmap.org/'+p.id&&clean(p.name)!==null&&typeof p.type==='string'&&Object.hasOwn(values,p.type)&&p.category===values[p.type]&&finite(p.lat,-90,90)&&finite(p.lon,-180,180)&&distance(city,p.lat,p.lon)<=3500&&(p.address===null||clean(p.address,200)!==null));
}
export class CityPlacesService {
 constructor(private readonly cache:Pick<LocalSourceCache,'read'>,private readonly clock:()=>number=Date.now){}
 async snapshot(city:City):Promise<CityPlaces>{try{const d=await this.cache.read(placesUrl(city),86400000);return parsePlaces(d.value,city,d.checkedAt,this.clock());}catch{return referencePlaces(city)??{state:'unavailable',checkedAt:null,validTo:null,dataAsOf:null,items:[]};}}
}
