import {DEFAULT_ORGANIZATION_SETUP,ORGANIZATION_PLANS,ORGANIZATION_STORAGE_KEY,ORGANIZATION_TOPICS,forgetOrganizationSetup,organizationFocusUrl,organizationPilotRequest,organizationPlan,rememberOrganizationSetup,restoreOrganizationSetup,validOrganizationSetup,type OrganizationSetup} from './setup.js';
function get<T extends HTMLElement>(id:string):T {const node=document.getElementById(id);if(!node)throw Error('ORGANIZATION_ELEMENT_MISSING');return node as T;}
const form=get<HTMLFormElement>('organization-setup');
const query=get<HTMLInputElement>('organization-query');
const name=get<HTMLInputElement>('organization-name');
const budget=get<HTMLSelectElement>('organization-budget');
const feedback=get<HTMLElement>('organization-feedback');
const savedStatus=get<HTMLElement>('organization-saved-status');
const savedLink=get<HTMLAnchorElement>('organization-continue');
const remove=get<HTMLButtonElement>('organization-forget');
const requestPanel=get<HTMLElement>('organization-request');
const requestText=get<HTMLTextAreaElement>('organization-request-text');
const requestLink=get<HTMLAnchorElement>('organization-email');
const topics=get<HTMLElement>('organization-topics');
const storage=():Storage=>window.localStorage;
for(const topic of ORGANIZATION_TOPICS){
 const label=document.createElement('label');label.className='org-choice';
 const input=document.createElement('input');input.type='checkbox';input.name='topic';input.value=topic.id;
 const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=topic.label;
 const scope=document.createElement('small');scope.textContent=topic.scope;copy.append(title,scope);label.append(input,copy);topics.append(label);
}
function setup():OrganizationSetup|null {
 const data=new FormData(form);const value:unknown={version:1,plan:data.get('plan'),topics:data.getAll('topic'),query:query.value.trim(),budget:Number(budget.value)};
 return validOrganizationSetup(value)?value:null;
}
function invalidateRequest():void{requestPanel.hidden=true;requestLink.removeAttribute('href');feedback.textContent='';}
function syncPlan():void{
 const plan=new FormData(form).get('plan');if(!organizationPlan(plan))return;
 get<HTMLElement>('organization-plan-name').textContent=ORGANIZATION_PLANS[plan].name;
 get<HTMLElement>('organization-plan-price').textContent=ORGANIZATION_PLANS[plan].price;
 document.querySelectorAll<HTMLButtonElement>('[data-org-plan]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.orgPlan===plan)));
}
function apply(value:OrganizationSetup):void{
 form.querySelectorAll<HTMLInputElement>('input[name=plan]').forEach(i=>{i.checked=i.value===value.plan;});
 form.querySelectorAll<HTMLInputElement>('input[name=topic]').forEach(i=>{i.checked=value.topics.some(t=>t===i.value);});
 query.value=value.query;budget.value=String(value.budget);syncPlan();
}
function savedNotice():ReturnType<typeof restoreOrganizationSetup>{
 const saved=restoreOrganizationSetup(storage);savedLink.hidden=saved.state!=='saved';remove.hidden=saved.state==='empty';
 if(saved.state==='saved'){savedLink.href=organizationFocusUrl(saved.setup);savedStatus.textContent=`${ORGANIZATION_PLANS[saved.setup.plan].name} setup saved in this browser. Reading is free; no subscription is active.`;}
 else {savedLink.removeAttribute('href');savedStatus.textContent=saved.state==='blocked'?'Browser storage is unavailable. You can preview and prepare a request without saving.':saved.state==='invalid'?'The saved setup could not be read. Clear it or explicitly replace it with your current choices.':'No organization setup is saved.';}
 return saved;
}
const restored=savedNotice();apply(restored.state==='saved'?restored.setup:DEFAULT_ORGANIZATION_SETUP);
form.addEventListener('input',invalidateRequest);
form.addEventListener('change',()=>{invalidateRequest();syncPlan();});
document.querySelectorAll<HTMLButtonElement>('[data-org-plan]').forEach(button=>button.addEventListener('click',()=>{
 const plan=button.dataset.orgPlan;if(!organizationPlan(plan))return;
 form.querySelectorAll<HTMLInputElement>('input[name=plan]').forEach(i=>{i.checked=i.value===plan;});invalidateRequest();syncPlan();form.scrollIntoView({block:'start',behavior:'auto'});get<HTMLElement>('organization-setup-title').focus();
}));
function chosen():OrganizationSetup|null{const value=setup();if(!value){feedback.textContent='Choose at least one connected topic and a filter of up to 200 characters.';topics.querySelector<HTMLInputElement>('input')?.focus();}return value;}
form.addEventListener('submit',event=>{event.preventDefault();const value=chosen();if(value)window.location.assign(organizationFocusUrl(value));});
get<HTMLButtonElement>('organization-remember').addEventListener('click',()=>{const value=chosen();if(!value)return;const outcome=rememberOrganizationSetup(storage,value);savedNotice();feedback.textContent=outcome==='saved'?'Setup remembered in this browser. Your organization name is not saved.':'Could not save this setup. Your reading preview still works.';});
remove.addEventListener('click',()=>{const outcome=forgetOrganizationSetup(storage);savedNotice();feedback.textContent=outcome==='cleared'?'Saved organization setup removed. Your personal briefing and city are unchanged.':'Could not remove the saved setup. Use browser site-data controls if storage remains blocked.';});
get<HTMLButtonElement>('organization-prepare').addEventListener('click',()=>{
 const value=chosen();if(!value)return;
 if(!name.checkValidity()||/[\u0000-\u001f\u007f\p{Surrogate}]/u.test(name.value)){feedback.textContent='Use an organization name of up to 100 characters, without line breaks.';name.focus();return;}
 const request=organizationPilotRequest(value,name.value);requestText.value=request.body;requestLink.href=request.mailto;requestPanel.hidden=false;feedback.textContent='Your request is ready to review below. Nothing has been sent.';requestText.focus();
});
get<HTMLButtonElement>('organization-copy').addEventListener('click',()=>{
 void (async()=>{try{if(!navigator.clipboard?.writeText)throw Error('CLIPBOARD_UNAVAILABLE');await navigator.clipboard.writeText(requestText.value);get<HTMLElement>('organization-copy-status').textContent='Request copied. You choose where and when to send it.';}catch{requestText.focus();requestText.select();get<HTMLElement>('organization-copy-status').textContent='Copy is unavailable. The request is selected so you can copy it manually.';}})();
});
window.addEventListener('storage',event=>{if(event.key===ORGANIZATION_STORAGE_KEY||event.key===null){savedNotice();feedback.textContent='Saved organization setup changed in another tab. Your unsaved form choices have been kept.';}});
