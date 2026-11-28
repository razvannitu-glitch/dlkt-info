import type {IncomingMessage,ServerResponse} from 'node:http';
import {searchCities,findCity,suggestCity,nearbyCities,cityAliases,listCountries} from '../src/local/cities.js';
import {object} from '../src/local/contracts.js';
import {coarseLocationRequest} from '../src/local/startup.js';
import {bodyJson,sameOrigin} from '../src/account/http.js';
function header(req:IncomingMessage,key:string):string{const v=req.headers[key];return typeof v==='string'&&v.length<=200?v:'';}
export async function handlePlaces(req:IncomingMessage,res:ServerResponse):Promise<void>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const send=(code:number,data:unknown)=>{res.statusCode=code;res.end(JSON.stringify(data));};
 try{
 const u=new URL(req.url??'/','https://www.dlkt.ee');const entries=[...u.searchParams.entries()];
 if(req.method==='GET'){
  if(entries.length!==1){send(400,{error:'PLACE_QUERY_INVALID'});return;}const [key,value]=entries[0]??[];
  if(key==='q'&&value!==undefined&&value.length<=100){send(200,{cities:searchCities(value,header(req,'x-vercel-ip-country')),scope:'GeoNames cities15000: larger cities and capitals; not an address search.'});return;}
  if(key==='id'&&value&&/^\d{1,12}$/u.test(value)){const city=findCity(value);send(city?200:404,{cities:city?[city]:[],cityAliases:city?cityAliases(city.id):[]});return;}
  if(key==='countries'&&value==='1'){send(200,{countries:listCountries()});return;}
  if(key==='hint'&&value==='1'){
   // These headers are only suggestions; they never authorize or select a location.
   const country=header(req,'x-vercel-ip-country');let name='';try{name=decodeURIComponent(header(req,'x-vercel-ip-city'));}catch{/* No guess on malformed data. */}
   const city=suggestCity(name,country),countryCode=listCountries().some(value=>value.code===country)?country:null;send(200,{city,countryCode,estimated:true});return;
  }
  send(400,{error:'PLACE_QUERY_INVALID'});return;
 }
 if(req.method==='POST'){
  if(entries.length||!sameOrigin(req,'local-place-1')){send(403,{error:'ORIGIN_REQUIRED'});return;}
  const data:unknown=await bodyJson(req,512);
  const coarse=object(data)&&Object.keys(data).sort().join(',')==='accuracy,lat,lon,timestamp'?coarseLocationRequest(data.lat,data.lon,data.accuracy,data.timestamp,Date.now()):null;
  if(coarse===null){send(400,{error:'LOCATION_NOT_PRECISE_OR_CURRENT'});return;}
  send(200,{nearby:nearbyCities(coarse.lat,coarse.lon),estimated:true,scope:'Nearby city centres, not proof that you are inside a city.'});return;
 }
 res.setHeader('Allow','GET, POST');send(405,{error:'METHOD_NOT_ALLOWED'});
 }catch{send(400,{error:'PLACE_REQUEST_INVALID'});}
}
export default handlePlaces;
