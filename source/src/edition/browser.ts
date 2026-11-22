import {cardGuideNode} from '../iceo/card-guide.js';
import {photoNode} from '../media/browser.js';
import {editorialCategory} from '../iceo/editorial-categories.js';
import {cardCreditsNode} from '../iceo/credits.js';
import type {ReaderSettings} from '../iceo/reader.js';
import {safeLink} from '../iceo/card-validation.js';
import {verifyBrowserArtifact,type EditionArtifact} from './artifact-contracts.js';
import {artifactText,artifactHtml} from './render.js';
function obj(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function text<K extends keyof HTMLElementTagNameMap>(tag:K,value:string,className=''):HTMLElementTagNameMap[K]{const n=document.createElement(tag);n.textContent=value;n.className=className;return n;}
export function setupEdition(readSettings:()=>ReaderSettings|null):void {
  const button=document.querySelector<HTMLButtonElement>('#prepare-edition'),section=document.querySelector<HTMLElement>('#prepared-edition'),message=document.querySelector<HTMLElement>('#edition-message'),content=document.querySelector<HTMLElement>('#edition-content'),download=document.querySelector<HTMLButtonElement>('#download-edition'),htmlDownload=document.querySelector<HTMLButtonElement>('#download-reading-copy');
  if(!button||!section||!message||!content||!download||!htmlDownload)return;
  let output:EditionArtifact|null=null;
  function save(format:'txt'|'html'):void{
    if(!output)return;const value=format==='txt'?artifactText(output):artifactHtml(output);
    const blob=new Blob([value],{type:format==='txt'?'text/plain;charset=utf-8':'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
    a.download=`dlkt-info-${output.edition.generatedAt.slice(0,10)}-${output.digest.slice(0,8)}.${format}`;
    a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  download.addEventListener('click',()=>save('txt'));htmlDownload.addEventListener('click',()=>save('html'));
  button.addEventListener('click',()=>{void(async()=>{
    const current=readSettings();
    if(!current||!current.topics.length){section.hidden=false;output=null;download.hidden=true;htmlDownload.hidden=true;content.replaceChildren();message.textContent='Choose at least one topic and a valid card count first.';return;}
    const settings:ReaderSettings={topics:[...current.topics],query:current.query,budget:current.budget,mode:'briefing'};
    button.disabled=true;section.hidden=false;content.replaceChildren();output=null;download.hidden=true;htmlDownload.hidden=true;
    message.textContent='Preparing the edition and checking supported source passages…';
    try{
      const response=await fetch('/api/edition',{method:'POST',credentials:'omit',headers:{Accept:'application/json','Content-Type':'application/json','X-DLKT-Info-Request':'edition-v1'},body:JSON.stringify({settings}),cache:'no-store',signal:AbortSignal.timeout(25_000)});
      if(!response.ok)throw Error('EDITION_REQUEST_FAILED');const data:unknown=await response.json();
      if(!obj(data))throw Error('EDITION_INVALID');const artifact=await verifyBrowserArtifact(data.artifact);
      if(!artifact||JSON.stringify(artifact.edition.settings)!==JSON.stringify(settings)||data.text!==artifactText(artifact)||JSON.stringify(data.edition)!==JSON.stringify(artifact.edition))throw Error('EDITION_INVALID');
      const e=artifact.edition,withPassages=artifact.insights.filter(i=>i.state==='ready').length,withFeedExcerpts=e.cards.filter(c=>c.summary!==undefined).length;
      message.textContent=e.state==='unavailable'?'The source check is unavailable. No complete edition is claimed.':e.cards.length?`${e.cards.length} cards prepared; ${withPassages} include verified publisher passages. ${withFeedExcerpts?`${withFeedExcerpts} include publisher feed excerpts. `:''}${e.state==='partial'?'Source coverage is partial. ':''}Cards without excerpts are labelled as listings. Nothing was emailed or saved to an account.`:'No eligible records in this selection. This is not a “nothing changed” result.';
      content.append(text('p',`Focus: ${settings.query||'No phrase filter'}. The downloaded files include this focus; share only with intended recipients.`));
      for(const [index,c]of e.cards.entries()){
        const insight=artifact.insights[index];if(!insight)throw Error('EDITION_INVALID');
        const article=text('article','','info-card'),inner=text('div','','card-content');article.dataset.editionCard=c.id;article.dataset.contentState=insight.state;
        const category=editorialCategory(c);if(category)article.dataset.editorialCategory=category;
        const photograph=photoNode(c);if(photograph)article.append(photograph);
        inner.append(text('h3',c.title));const credit=cardCreditsNode(c);if(credit)inner.append(credit);inner.append(text('p',`${c.publisher} · ${c.dateLabel}: ${c.date}`,'card-date'));inner.append(cardGuideNode(c));
        if(c.summary!==undefined){
          const terms=text('a','Source terms');terms.href=safeLink(insight.termsUrl)??'#';terms.rel='noopener noreferrer';terms.target='_blank';
          inner.append(text('p','Publisher excerpt from the source feed:','privacy-note'),text('p',c.summary),text('p',c.attribution,'privacy-note'),terms,text('p',c.boundary,'privacy-note'));
        }
        if(insight.state==='ready'){
          inner.append(text('p',insight.introduction,'insight-intro'));for(const p of insight.points)inner.append(text('blockquote',p.text,'insight-excerpt'));
          inner.append(text('p',`Content checked: ${insight.checkedAt}. Selected passages, not a full-document summary.`,'privacy-note'));
          const details=text('details',''),summary=text('summary','Evidence and source terms'),terms=text('a','Source terms');terms.href=safeLink(insight.termsUrl)??'#';terms.rel='noopener noreferrer';terms.target='_blank';
          details.append(summary,text('p',insight.attribution),text('p',insight.nextStep),terms);inner.append(details);
        }else if(c.summary===undefined)inner.append(text('p',insight.state==='unsupported'?'Listing only. This format is not supported for content extraction.':'Listing only. Source content could not be verified during preparation.','privacy-note'));
        const source=text('a','Read source','source-link');source.href=safeLink(c.sourceUrl)??'#';source.rel='noopener noreferrer';source.target='_blank';inner.append(source);
        const group=e.storyGroups?.find(item=>item.primaryId===c.id);
        if(group){
          const details=text('details',''),list=text('ul','');
          details.append(text('summary',group.basis==='software-versions'?'Other listed software versions':'Other original listings for this story; reports may differ and are not independent confirmations'));
          for(const related of group.related){
            const item=text('li',''),link=text('a',related.title);link.dir='auto';link.translate=false;link.href=safeLink(related.sourceUrl)??'#';link.rel='noopener noreferrer';link.target='_blank';item.append(link);
            const credits=cardCreditsNode(related);if(credits)item.append(credits);
            item.append(text('p',`${related.publisher} · ${related.dateLabel}: ${related.date} · Source checked: ${related.observedAt}`));
            if(related.summary!==undefined){const excerpt=text('p',related.summary);excerpt.dir='auto';excerpt.translate=false;item.append(text('p','Publisher excerpt from the source feed:'),excerpt);}
            item.append(text('p',related.attribution),text('p',related.boundary));list.append(item);
          }
          details.append(list);inner.append(details);
        }
        article.append(inner);content.append(article);
      }
      if(e.state!=='unavailable'){output=artifact;download.hidden=false;htmlDownload.hidden=false;}
    }catch{content.replaceChildren();message.textContent='This edition could not be prepared or its evidence could not be validated. Saved data was not changed.';}
    finally{button.disabled=false;}
  })();});
}
