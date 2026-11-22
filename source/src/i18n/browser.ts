import {LOCALES,resolveLocale,localeUrl,t,categoryLabel,type Locale,type MessageKey} from './locale.js';
import {PUBLIC_EDITORIAL_CATEGORIES,type PublicEditorialCategory} from '../iceo/editorial-categories.js';

/** Presentation language is URL/browser state, never a change to a saved profile or a source record. */
export function getLocale():Locale {
  return resolveLocale(typeof window==='undefined'?null:window.location.href,typeof navigator==='undefined'?[]:navigator.languages??[navigator.language]);
}
export function translate(key:MessageKey,params?:Readonly<Record<string,string|number>>):string {return t(getLocale(),key,params);}
export function translatedCategory(category:PublicEditorialCategory):string {return categoryLabel(getLocale(),category);}
export function countryLabel(code:string,fallback=code):string {
  if(!/^[A-Z]{2}$/u.test(code))return fallback;
  try{return new Intl.DisplayNames([getLocale()],{type:'region',fallback:'none'}).of(code)??fallback;}catch{return fallback;}
}
export function languageLabel(code:string):string {
  try{return new Intl.DisplayNames([getLocale()],{type:'language',fallback:'none'}).of(code)??code;}catch{return code;}
}

/** Appearance stays in its own controller; translation changes only the action label. */
function applyAppearanceLabel():void {
  const button=document.getElementById('reader-theme-toggle');if(!button)return;
  const key:MessageKey=document.documentElement.dataset.readerTheme==='night'?'switchToLightMode':'switchToDarkMode';
  const label=translate(key);button.dataset.i18nLabel=key;
  button.setAttribute('aria-label',label);button.setAttribute('title',label);
}

/** Bind only explicitly marked interface nodes. Publisher wording is never traversed or replaced. */
export function applyInterfaceLanguage(root:ParentNode=document):void {
  applyAppearanceLabel();
  for(const brand of root.querySelectorAll<HTMLElement>('.brand-header,.brand-footer')){brand.lang='en';brand.dir='ltr';brand.setAttribute('translate','no');}
  for(const item of root.querySelectorAll<HTMLElement>('[data-i18n]')){
    const key=item.dataset.i18n as MessageKey|undefined;
    if(key==='photoArchiveLabel'){
      const year=item.dataset.i18nYear;if(year&&/^(?:19|20)\d{2}$/u.test(year))item.textContent=translate(key,{year});
    }else if(key)item.textContent=translate(key);
  }
  for(const item of root.querySelectorAll<HTMLElement>('[data-i18n-label]')){
    const key=item.dataset.i18nLabel as MessageKey|undefined;if(key)item.setAttribute('aria-label',translate(key));
  }
  for(const item of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')){
    const key=item.dataset.i18nPlaceholder as MessageKey|undefined;if(key)item.placeholder=translate(key);
  }
  // Existing native topic inputs retain their identity, selection and private persistence behavior.
  for(const input of root.querySelectorAll<HTMLInputElement>('input[name="topic"]')){
    if(!(PUBLIC_EDITORIAL_CATEGORIES as readonly string[]).includes(input.value))continue;
    const span=input.parentElement?.querySelector('span');if(span)span.textContent=translatedCategory(input.value as PublicEditorialCategory);
  }
}

export function setupLanguage():void {
  const picker=document.getElementById('reader-language');
  if(!(picker instanceof HTMLSelectElement))throw Error('I18N_PICKER_MISSING');
  for(const locale of LOCALES){
    const option=document.createElement('option');option.value=locale.code;option.lang=locale.code;option.dir=locale.direction;option.textContent=locale.nativeName;picker.append(option);
  }
  let applied:Locale|null=null;
  const apply=():void=>{
    const locale=getLocale(),definition=LOCALES.find(value=>value.code===locale);
    if(!definition)throw Error('I18N_CATALOG_INVALID');
    document.documentElement.lang=locale;document.documentElement.dir=definition.direction;picker.value=locale;
    applyInterfaceLanguage();
    if(applied!==locale){applied=locale;document.dispatchEvent(new CustomEvent('dlkt:language-changed',{detail:{locale}}));}
  };
  picker.addEventListener('change',()=>{
    if(!LOCALES.some(value=>value.code===picker.value))return;
    history.pushState(null,'',localeUrl(window.location.href,picker.value as Locale));apply();
  });
  window.addEventListener('popstate',apply);
  window.addEventListener('languagechange',apply);
  // Entry controllers may update contextual labels, but never the source content.
  document.addEventListener('dlkt:entry-view',()=>applyInterfaceLanguage());
  document.addEventListener('dlkt:theme-changed',applyAppearanceLabel);
  apply();
}
