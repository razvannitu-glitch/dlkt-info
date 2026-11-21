import {PUBLIC_EDITORIAL_CATEGORIES,type PublicEditorialCategory} from '../iceo/editorial-categories.js';
import {validCity,type City} from '../local/contracts.js';

/** Navigation state only. These helpers neither read nor write remembered preferences. */
export interface ExploreState {
  readonly active:boolean;
  readonly cityId:string|null;
  readonly countryCode:string|null;
  readonly category:PublicEditorialCategory|null;
}

export const EMPTY_EXPLORE_STATE:ExploreState=Object.freeze({active:false,cityId:null,countryCode:null,category:null});
const OWNED_PARAMETERS=['explore','city','country','category'] as const;
const CITY_ID=/^[1-9]\d{0,11}$/u;
const COUNTRY_CODE=/^[A-Z]{2}$/u;
const categoryValid=(value:unknown):value is PublicEditorialCategory=>typeof value==='string'&&PUBLIC_EDITORIAL_CATEGORIES.some(category=>category===value);
const one=(params:URLSearchParams,key:string):string|null=>params.getAll(key).length===1?params.get(key):null;
const copyUrl=(input:string|URL):URL=>new URL(input instanceof URL?input.href:input,'https://explore.invalid/');

function checked(state:ExploreState):ExploreState {
  if(typeof state.active!=='boolean'||state.cityId!==null&&!CITY_ID.test(state.cityId)
    ||state.countryCode!==null&&!COUNTRY_CODE.test(state.countryCode)
    ||state.category!==null&&!categoryValid(state.category))throw Error('EXPLORE_STATE_INVALID');
  return Object.freeze({...state});
}

/** Invalid or repeated optional values are ignored, never passed to an API or storage. */
export function parseExploreState(input:string|URL):ExploreState {
  let url:URL;
  try{url=copyUrl(input);}catch{return EMPTY_EXPLORE_STATE;}
  if(one(url.searchParams,'explore')!=='1')return EMPTY_EXPLORE_STATE;
  const city=one(url.searchParams,'city'),country=one(url.searchParams,'country'),category=one(url.searchParams,'category');
  return Object.freeze({active:true,cityId:city!==null&&CITY_ID.test(city)?city:null,
    countryCode:country!==null&&/^[A-Za-z]{2}$/u.test(country)?country.toUpperCase():null,
    category:categoryValid(category)?category:null});
}

/** Change only Explore's four parameters; retain unrelated parameters, duplicates and hash. */
export function exploreUrl(input:string|URL,state:ExploreState):string {
  checked(state);
  const url=copyUrl(input);
  for(const key of OWNED_PARAMETERS)url.searchParams.delete(key);
  if(state.active){
    url.searchParams.set('explore','1');
    if(state.cityId!==null)url.searchParams.set('city',state.cityId);
    if(state.countryCode!==null)url.searchParams.set('country',state.countryCode);
    if(state.category!==null)url.searchParams.set('category',state.category);
  }
  if(input instanceof URL||/^[a-z][a-z\d+.-]*:/iu.test(input))return url.href;
  if(input.startsWith('//'))return '//'+url.host+url.pathname+url.search+url.hash;
  if(input.startsWith('?')||input.startsWith('#'))return url.search+url.hash;
  return (input.startsWith('/')?url.pathname:url.pathname.slice(1))+url.search+url.hash;
}

/** Switching places preserves the selected editorial category. Clearing a city keeps its country. */
export function selectExploreCity(state:ExploreState,city:City|null):ExploreState {
  checked(state);
  if(city!==null&&!validCity(city))throw Error('EXPLORE_CITY_INVALID');
  return checked({...state,active:true,cityId:city?.id??null,countryCode:city?.countryCode??state.countryCode});
}

/** Country selection deliberately leaves city mode; null selects the connected worldwide corpus. */
export function selectExploreCountry(state:ExploreState,countryCode:string|null):ExploreState {
  checked(state);
  if(countryCode!==null&&!/^[A-Za-z]{2}$/u.test(countryCode))throw Error('EXPLORE_STATE_INVALID');
  return checked({...state,active:true,cityId:null,countryCode:countryCode?.toUpperCase()??null});
}

export function selectExploreCategory(state:ExploreState,category:PublicEditorialCategory|null):ExploreState {
  checked(state);
  return checked({...state,active:true,category});
}
