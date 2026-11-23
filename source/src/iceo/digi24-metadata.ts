import {canonicalNewsUrl, publisherForNewsUrl} from './news-sources.js';

export interface Digi24HeadlineEvidence {
  /** Sanitized JSON-LD headline from the Article already bound to the canonical URL. */
  readonly articleHeadline:string;
  readonly candidateTitle:string;
  /** Only complete meta elements that are direct children of the document head. */
  readonly headTitles:readonly (string|null)[];
  readonly headUrls:readonly (string|undefined)[];
  readonly canonicalUrl:string;
}

function title(value:string|null|undefined):string|null{
  if(typeof value!=='string'||value.length<1||value.length>200||/[<>\u0000-\u001f\u007f]/u.test(value))return null;
  const normalized=value.normalize('NFC').replace(/\s+/gu,' ').trim();
  return normalized.length?normalized:null;
}

/**
 * Digi24's reviewed originals shorten JSON-LD headlines with three dots while
 * publishing the full headline in head og:title. This resolves only that form.
 * The caller must retain the canonical Article binding and its existing
 * JSON-LD local date / explicit head publish-date equality checks.
 * This helper supplies neither a publication timestamp nor a timezone.
 */
export function completeDigi24TruncatedHeadline(evidence:Digi24HeadlineEvidence):string|null{
  if(publisherForNewsUrl(evidence.canonicalUrl)?.id!=='digi24'
    ||canonicalNewsUrl(evidence.canonicalUrl)!==evidence.canonicalUrl)return null;
  const abbreviated=title(evidence.articleHeadline),candidate=title(evidence.candidateTitle);
  if(!abbreviated||!candidate||!abbreviated.endsWith('...'))return null;
  const prefix=abbreviated.slice(0,-3);
  // A long exact original prefix is identity evidence; no fuzzy similarity,
  // guessed suffix, transliteration, or substitution of an index headline.
  if(prefix.length<80||prefix.endsWith('.')||abbreviated.length>=candidate.length)return null;
  if(evidence.headTitles.length!==1||evidence.headUrls.length!==1)return null;
  const full=title(evidence.headTitles[0]),url=evidence.headUrls[0];
  if(!full||typeof url!=='string'||/[\u0000-\u0020\u007f<>\\]/u.test(url)
    ||canonicalNewsUrl(url)!==evidence.canonicalUrl
    ||publisherForNewsUrl(url)?.id!=='digi24')return null;
  const key=(value:string):string=>value.normalize('NFKC').toLowerCase();
  if(key(full)!==key(candidate)||!key(full).startsWith(key(prefix)))return null;
  return full;
}
