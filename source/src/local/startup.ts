import {object,validCity,finite,type City} from './contracts.js';

export interface CoarseLocationRequest {readonly lat:number;readonly lon:number;readonly accuracy:number;readonly timestamp:number}
/** Retain only coarse coordinates; account for the distance lost to rounding.
 * The result is a search origin for city centres, never a proof of an address.
 */
export function coarseLocationRequest(lat:unknown,lon:unknown,accuracy:unknown,timestamp:unknown,now:number):CoarseLocationRequest|null {
  if(!Number.isFinite(now)||!finite(lat,-90,90)||!finite(lon,-180,180)||!finite(accuracy,0,5000)||!finite(timestamp,now-120000,now+5000))return null;
  const roundedLat=Math.round(lat*100)/100,roundedLon=Math.round(lon*100)/100;
  // 112 km per degree per axis is a conservative upper bound; sum of
  // the two displacements deliberately overstates, never hides, uncertainty.
  const rounding=Math.ceil(112000*(Math.abs(lat-roundedLat)+Math.abs(lon-roundedLon)));
  const effectiveAccuracy=Math.ceil(accuracy+rounding);
  if(effectiveAccuracy>5000)return null;
  return Object.freeze({lat:roundedLat,lon:roundedLon,accuracy:effectiveAccuracy,timestamp});
}

export interface CurrentCityStartup {
  readonly readHint:()=>Promise<unknown>;
  readonly maySelect:()=>boolean;
  readonly select:(city:City)=>Promise<void>;
}

export type CurrentCityStartupResult='selected'|'unavailable'|'superseded';

/** One current connection hint. Stored preferences never establish the current location. */
export async function initializeCurrentCity(port:CurrentCityStartup):Promise<CurrentCityStartupResult>{
  if(!port.maySelect())return 'superseded';
  let hint:unknown;
  try{hint=await port.readHint();}
  catch{return port.maySelect()?'unavailable':'superseded';}
  // A choice made while the request was pending is authoritative for this visit.
  if(!port.maySelect())return 'superseded';
  if(!object(hint)||hint.estimated!==true||!validCity(hint.city)||
    Object.hasOwn(hint,'countryCode')&&hint.countryCode!==hint.city.countryCode)return 'unavailable';
  await port.select(hint.city);
  return 'selected';
}
