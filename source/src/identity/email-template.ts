import {LOCALES,type Locale} from '../i18n/locale.js';
import {WELCOME_COPY,type WelcomeCopy} from '../brand/welcome-copy.js';
import {authenticationEmailRedirect} from './email-locale.js';

export const AUTHENTICATION_EMAIL_SUBJECT='DLKT · Daily Life. Key Things.';
export const AUTHENTICATION_EMAIL_KATE='https://www.dlkt.ee/kate-head.png';
function escapeHtml(value:string):string{
  return value.replace(/[&<>"']/gu,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]??character));
}
type CopyField=keyof WelcomeCopy;
type EmailContent=Readonly<{language:string;direction:string;title:string;instruction:string;value:string;security:string;token:string}>;
const EMAIL_DOCUMENT="<!doctype html>\n<html lang=\"__DLKT_language__\" dir=\"__DLKT_direction__\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>DLKT · Daily Life. Key Things.</title></head>\n<body style=\"margin:0;padding:0;background-color:#efede4;color:#152e41;font-family:Arial,Helvetica,sans-serif;\">\n<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;background-color:#efede4;\"><tr><td align=\"center\" style=\"padding:24px 12px;\">\n<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;max-width:600px;background-color:#ffffff;border:1px solid #d8d8d2;border-radius:20px;\"><tr><td style=\"padding:28px 24px;\">\n<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" dir=\"ltr\"><tr><td style=\"padding:0 16px 0 0;vertical-align:middle;\"><img src=\"https://www.dlkt.ee/kate-head.png\" width=\"72\" height=\"72\" alt=\"Kate\" style=\"display:block;width:72px;height:72px;border:0;\"></td><td style=\"vertical-align:middle;\"><p style=\"margin:0;color:#111514;font-size:30px;line-height:1.1;font-weight:700;letter-spacing:-1px;\">DLKT</p><p style=\"margin:7px 0 0;color:#152e41;font-size:13px;line-height:1.5;\">Daily Life. Key Things.</p></td></tr></table>\n<h1 style=\"margin:28px 0 12px;color:#111514;font-size:26px;line-height:1.25;font-weight:700;overflow-wrap:anywhere;\">__DLKT_title__</h1>\n<p style=\"margin:0 0 20px;color:#152e41;font-size:16px;line-height:1.7;\">__DLKT_instruction__</p>\n<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;background-color:#efede4;border:1px solid #d8d8d2;border-radius:12px;\"><tr><td align=\"center\" style=\"padding:20px 12px;\"><p dir=\"ltr\" style=\"margin:0;color:#152e41;font-family:Courier New,Courier,monospace;font-size:28px;line-height:1.4;font-weight:700;letter-spacing:2px;\">__DLKT_token__</p></td></tr></table>\n<p style=\"margin:20px 0 0;color:#455864;font-size:13px;line-height:1.7;\">__DLKT_security__</p>\n<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"width:100%;margin-top:26px;border-top:1px solid #d8d8d2;\"><tr><td style=\"padding:22px 0 0;\"><p style=\"margin:0;color:#152e41;font-size:15px;line-height:1.8;\">__DLKT_value__</p><p dir=\"ltr\" style=\"margin:16px 0 0;color:#152e41;font-size:12px;line-height:1.6;font-weight:700;\">DLKT · Daily Life. Key Things.</p></td></tr></table>\n</td></tr></table>\n</td></tr></table>\n</body>\n</html>\n";
/** All content is fixed catalog copy or explicitly escaped preview text. */
function documentFor(content:EmailContent):string{
  return EMAIL_DOCUMENT.replace(/__DLKT_(language|direction|title|instruction|value|security|token)__/gu,
    (_match:string,key:keyof EmailContent)=>content[key]);
}
function selectTemplateValue(values:Readonly<Record<Locale,string>>):string{
  const choices=LOCALES.filter(locale=>locale.code!=='en');
  return choices.map((locale,index)=>
    '{{ '+(index===0?'if':'else if')+' eq .RedirectTo "'+authenticationEmailRedirect(locale.code)+'" }}'+values[locale.code]
  ).join('')+'{{ else }}'+values.en+'{{ end }}';
}
function copyValues(field:CopyField):Readonly<Record<Locale,string>>{
  return Object.fromEntries(LOCALES.map(locale=>[locale.code,escapeHtml(WELCOME_COPY[locale.code][field])])) as Readonly<Record<Locale,string>>;
}
/** Hosted Supabase Auth Go template. Current request wins; stored metadata is never consulted. */
export function authenticationEmailTemplate():string{
  const languages=Object.fromEntries(LOCALES.map(locale=>[locale.code,locale.code])) as Readonly<Record<Locale,string>>;
  const directions=Object.fromEntries(LOCALES.map(locale=>[locale.code,locale.direction])) as Readonly<Record<Locale,string>>;
  return documentFor({language:selectTemplateValue(languages),direction:selectTemplateValue(directions),
    title:selectTemplateValue(copyValues('title')),instruction:selectTemplateValue(copyValues('instruction')),
    value:selectTemplateValue(copyValues('value')),security:selectTemplateValue(copyValues('security')),token:'{{ .Token }}'});
}
/** Synthetic-only preview: it never requests or delivers a sign-in code. */
export function authenticationEmailPreview(locale:Locale,token='00000000'):string{
  const definition=LOCALES.find(item=>item.code===locale);
  if(!definition)throw Error('AUTHENTICATION_EMAIL_LOCALE_INVALID');
  if(!/^0{6,10}$/u.test(token))throw Error('AUTHENTICATION_EMAIL_PREVIEW_TOKEN_INVALID');
  const copy=WELCOME_COPY[locale];
  return documentFor({language:locale,direction:definition.direction,title:escapeHtml(copy.title),
    instruction:escapeHtml(copy.instruction),value:escapeHtml(copy.value),security:escapeHtml(copy.security),token});
}
