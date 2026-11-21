/** One native navigation: horizontal on desktop, a full-width disclosure on mobile. */
export function setupHeader(): void {
 const toggle=document.getElementById('header-menu');
 const nav=document.getElementById('header-navigation');
 const header=nav?.closest<HTMLElement>('.site-header');
 if(!(toggle instanceof HTMLButtonElement)||!nav||!header)return;
 const narrow=matchMedia('(max-width: 1024px)');
 const label=toggle.querySelector<HTMLElement>('[data-menu-label]');
 const first=():HTMLElement|null=>nav.querySelector<HTMLElement>('button:not([hidden]),a[href]');
 const expanded=(open:boolean):void=>{
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'Close menu':'Open menu');
  if(label)label.textContent=open?'Close':'Menu';
 };
 const close=(restore=nav.contains(document.activeElement)):void=>{
  expanded(false);
  if(narrow.matches)nav.hidden=true;
  if(restore&&narrow.matches)toggle.focus();
 };
 const current=():void=>{
  for(const item of nav.querySelectorAll<HTMLElement>('[aria-current]'))item.removeAttribute('aria-current');
  const view=document.body.dataset.entryView;
  const selected=document.body.dataset.worldExplore==='active'?'world-nav':view==='start'?'entry-today':view==='topics'&&document.querySelector('[data-view="saved"][aria-pressed="true"]')?'entry-saved':null;
  if(selected)document.getElementById(selected)?.setAttribute('aria-current','page');
 };
 const layout=():void=>{
  const inside=nav.contains(document.activeElement),onToggle=document.activeElement===toggle;
  toggle.hidden=!narrow.matches;nav.hidden=narrow.matches;expanded(false);
  if(narrow.matches&&inside)toggle.focus();
  else if(!narrow.matches&&onToggle)first()?.focus();
 };
 toggle.addEventListener('click',()=>{
  if(toggle.getAttribute('aria-expanded')==='true'){close(true);return;}
  nav.hidden=false;expanded(true);first()?.focus();
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&toggle.getAttribute('aria-expanded')==='true'){event.preventDefault();close(true);}});
 document.addEventListener('click',event=>{if(event.target instanceof Node&&!nav.contains(event.target)&&!toggle.contains(event.target))close();});
 nav.addEventListener('click',event=>{
  if(!(event.target instanceof Element)||!event.target.closest('button,a'))return;
  const dialog=document.querySelector<HTMLDialogElement>('dialog[open]');
  close();
  if(dialog)dialog.addEventListener('close',()=>{queueMicrotask(()=>{if(narrow.matches&&(document.activeElement===document.body||nav.contains(document.activeElement)||dialog.contains(document.activeElement)))toggle.focus();});},{once:true});
  queueMicrotask(current);
 });
 nav.addEventListener('focusout',event=>{const next=event.relatedTarget;if(next instanceof Node&&!nav.contains(next)&&next!==toggle)close(false);});
 document.addEventListener('dlkt:entry-view',current);
 document.addEventListener('dlkt:explore-view',current);
 document.addEventListener('dlkt:reader-selected',()=>queueMicrotask(current));
 narrow.addEventListener('change',layout);
 layout();current();header.dataset.navigationReady='true';
}
