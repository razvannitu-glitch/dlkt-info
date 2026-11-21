import {cityJson} from './city-data.js';
import {object,validCity,finite,type City} from './contracts.js';
interface IndexedCity {readonly city:City;readonly names:readonly string[];readonly context:string;readonly population:number}
export function normalizePlace(text:string):string{return text.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
let index:readonly IndexedCity[]|null=null;let byId:ReadonlyMap<string,City>|null=null;
function catalog():readonly IndexedCity[]{
 if(index)return index;const data:unknown=JSON.parse(cityJson);if(!object(data)||data.version!=='dlkt-cities-1'||!Array.isArray(data.rows)||data.rows.length>100000)throw Error('CITY_CATALOG_INVALID');
 const zones=new Set<string>();const ids=new Set<string>();
 index=data.rows.map((row:unknown)=>{if(!Array.isArray(row)||row.length!==10||!Array.isArray(row[9])||row[9].some(n=>typeof n!=='string'))throw Error('CITY_CATALOG_INVALID');const c={id:row[0],name:row[1],countryCode:row[2],country:row[3],region:row[4],lat:row[5],lon:row[6],timezone:row[7]};if(!validCity(c)||!finite(row[8],0,1000000000)||ids.has(c.id))throw Error('CITY_CATALOG_INVALID');if(!zones.has(c.timezone)){new Intl.DateTimeFormat('en',{timeZone:c.timezone});zones.add(c.timezone);}ids.add(c.id);return{city:c,names:[c.name,...row[9] as string[]].map(normalizePlace),context:normalizePlace(c.country+' '+c.countryCode+' '+c.region),population:row[8]};});
 byId=new Map(index.map(x=>[x.city.id,x.city]));return index;
}
export function findCity(id:string):City|null{catalog();return byId?.get(id)??null;}
export function searchCities(input:string,country:string|null=null,limit=8):readonly City[]{
 if(input.length>100||!Number.isInteger(limit)||limit<1||limit>12)throw Error('CITY_SEARCH_INVALID');const q=normalizePlace(input);if(!q)return[];const tokens=q.split(' ');
 return catalog().map(x=>{const primary=x.names[0]??'';const alias=(q.length>1||!/^[a-z0-9]$/u.test(q))&&x.names.some(n=>n.startsWith(q));const all=q.length>1&&tokens.every(t=>x.names.some(n=>n.split(' ').some(p=>p.startsWith(t)))||x.context.split(' ').some(p=>p.startsWith(t)));return{x,score:primary===q?0:q.length>1&&x.names.includes(q)?1:primary.startsWith(q)?2:alias?3:all?4:9};}).filter(v=>v.score<9).sort((a,b)=>a.score-b.score||Number(b.x.city.countryCode===country)-Number(a.x.city.countryCode===country)||b.x.population-a.x.population||a.x.city.id.localeCompare(b.x.city.id)).slice(0,limit).map(v=>v.x.city);
}
export function suggestCity(name:string,country:string):City|null {const q=normalizePlace(name);if(!q||!/^[A-Z]{2}$/u.test(country))return null;const matches=catalog().filter(c=>c.city.countryCode===country&&c.names.includes(q));return matches.length===1?matches[0]?.city??null:null;}
export function nearbyCities(lat:number,lon:number):readonly {city:City;distanceKm:number}[]{
 if(!finite(lat,-90,90)||!finite(lon,-180,180))throw Error('CITY_COORDINATES_INVALID');const rad=Math.PI/180;
 return catalog().map(({city})=>{const a=Math.sin((city.lat-lat)*rad/2)**2+Math.cos(lat*rad)*Math.cos(city.lat*rad)*Math.sin((city.lon-lon)*rad/2)**2;return{city,distanceKm:Math.round(6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)))*10)/10};}).filter(r=>r.distanceKm<=50).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,5);
}
