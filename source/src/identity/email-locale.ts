import {resolveLocale} from '../i18n/locale.js';
/** Fixed first-party destination; the only variable is a shipped catalog code. */
export function authenticationEmailRedirect(locale:string):string{
  return 'https://www.dlkt.ee/account?lang='+encodeURIComponent(resolveLocale(locale));
}
