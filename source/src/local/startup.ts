import {object,validCity,type City} from './contracts.js';

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
  if(!object(hint)||hint.estimated!==true||!validCity(hint.city))return 'unavailable';
  await port.select(hint.city);
  return 'selected';
}
