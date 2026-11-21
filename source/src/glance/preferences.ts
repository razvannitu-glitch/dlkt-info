import {DEFAULT_PREFERENCES,validPreferences,type GlancePreferences} from './contracts.js';
const KEY='dlkt-glance-preferences-1';
type PreferenceStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
/** The accessor itself can throw when a browser denies storage. */
export function readPreferences(storage:()=>PreferenceStorage):GlancePreferences {
 try{const raw=storage().getItem(KEY);if(raw&&raw.length<1000){const v:unknown=JSON.parse(raw);if(validPreferences(v))return v;}}catch{/* Defaults remain usable without persistence. */}
 return {...DEFAULT_PREFERENCES};
}
export function savePreferences(value:GlancePreferences,storage:()=>PreferenceStorage):boolean {
 if(!validPreferences(value))return false;try{storage().setItem(KEY,JSON.stringify(value));return true;}catch{return false;}
}
export function clearPreferences(storage:()=>PreferenceStorage):void {try{storage().removeItem(KEY);}catch{/* Clearing still applies to this visit. */}}
