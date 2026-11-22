import { setupCommercialRequest } from './commercial-browser.js';
import { DEFAULT_ORGANIZATION_SETUP, ORGANIZATION_PLANS, ORGANIZATION_STORAGE_KEY, ORGANIZATION_TOPICS, forgetOrganizationSetup, organizationFocusUrl, organizationPilotRequest, organizationPlan, rememberOrganizationSetup, restoreOrganizationSetup, validOrganizationSetup } from './organization-setup.js';
function get(id) { const node = document.getElementById(id); if (!node)
    throw Error('ORGANIZATION_ELEMENT_MISSING'); return node; }
const form = get('organization-setup');
const query = get('organization-query');
const name = get('organization-name');
const budget = get('organization-budget');
const feedback = get('organization-feedback');
const savedStatus = get('organization-saved-status');
const savedLink = get('organization-continue');
const remove = get('organization-forget');
const requestPanel = get('organization-request');
const requestText = get('organization-request-text');
const requestLink = get('organization-email');
const topics = get('organization-topics');
const storage = () => window.localStorage;
for (const topic of ORGANIZATION_TOPICS) {
    const label = document.createElement('label');
    label.className = 'org-choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'topic';
    input.value = topic.id;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = topic.label;
    const scope = document.createElement('small');
    scope.textContent = topic.scope;
    copy.append(title, scope);
    label.append(input, copy);
    topics.append(label);
}
function setup() {
    const data = new FormData(form);
    const value = { version: 1, plan: data.get('plan'), topics: data.getAll('topic'), query: query.value.trim(), budget: Number(budget.value) };
    return validOrganizationSetup(value) ? value : null;
}
function invalidateRequest() { requestPanel.hidden = true; requestLink.removeAttribute('href'); feedback.textContent = ''; }
function syncPlan() {
    const plan = new FormData(form).get('plan');
    if (!organizationPlan(plan))
        return;
    get('organization-plan-name').textContent = ORGANIZATION_PLANS[plan].name;
    get('organization-plan-price').textContent = ORGANIZATION_PLANS[plan].price;
    document.querySelectorAll('[data-org-plan]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.orgPlan === plan)));
}
function apply(value) {
    form.querySelectorAll('input[name=plan]').forEach(i => { i.checked = i.value === value.plan; });
    form.querySelectorAll('input[name=topic]').forEach(i => { i.checked = value.topics.some(t => t === i.value); });
    query.value = value.query;
    budget.value = String(value.budget);
    syncPlan();
}
function savedNotice() {
    const saved = restoreOrganizationSetup(storage);
    savedLink.hidden = saved.state !== 'saved';
    remove.hidden = saved.state === 'empty';
    if (saved.state === 'saved') {
        savedLink.href = organizationFocusUrl(saved.setup);
        savedStatus.textContent = `${ORGANIZATION_PLANS[saved.setup.plan].name} setup saved in this browser. Reading is free; no subscription is active.`;
    }
    else {
        savedLink.removeAttribute('href');
        savedStatus.textContent = saved.state === 'blocked' ? 'Browser storage is unavailable. You can preview and prepare a request without saving.' : saved.state === 'invalid' ? 'The saved setup could not be read. Clear it or explicitly replace it with your current choices.' : 'No organization setup is saved.';
    }
    return saved;
}
const restored = savedNotice();
apply(restored.state === 'saved' ? restored.setup : DEFAULT_ORGANIZATION_SETUP);
form.addEventListener('input', invalidateRequest);
form.addEventListener('change', () => { invalidateRequest(); syncPlan(); });
document.querySelectorAll('[data-org-plan]').forEach(button => button.addEventListener('click', () => {
    const plan = button.dataset.orgPlan;
    if (!organizationPlan(plan))
        return;
    form.querySelectorAll('input[name=plan]').forEach(i => { i.checked = i.value === plan; });
    invalidateRequest();
    syncPlan();
    form.scrollIntoView({ block: 'start', behavior: 'auto' });
    get('organization-setup-title').focus();
}));
function chosen() { const value = setup(); if (!value) {
    feedback.textContent = 'Choose at least one connected topic and a filter of up to 200 characters.';
    topics.querySelector('input')?.focus();
} return value; }
form.addEventListener('submit', event => { event.preventDefault(); const value = chosen(); if (value)
    window.location.assign(organizationFocusUrl(value)); });
get('organization-remember').addEventListener('click', () => { const value = chosen(); if (!value)
    return; const outcome = rememberOrganizationSetup(storage, value); savedNotice(); feedback.textContent = outcome === 'saved' ? 'Setup remembered in this browser. Your organization name is not saved.' : 'Could not save this setup. Your reading preview still works.'; });
remove.addEventListener('click', () => { const outcome = forgetOrganizationSetup(storage); savedNotice(); feedback.textContent = outcome === 'cleared' ? 'Saved organization setup removed. Your personal briefing and city are unchanged.' : 'Could not remove the saved setup. Use browser site-data controls if storage remains blocked.'; });
get('organization-prepare').addEventListener('click', () => {
    const value = chosen();
    if (!value)
        return;
    if (!name.checkValidity() || /[\u0000-\u001f\u007f\p{Surrogate}]/u.test(name.value)) {
        feedback.textContent = 'Use an organization name of up to 100 characters, without line breaks.';
        name.focus();
        return;
    }
    const request = organizationPilotRequest(value, name.value);
    requestText.value = request.body;
    requestLink.href = request.mailto;
    requestPanel.hidden = false;
    feedback.textContent = 'Your request is ready to review below. Nothing has been sent.';
    requestText.focus();
});
get('organization-copy').addEventListener('click', () => {
    void (async () => { try {
        if (!navigator.clipboard?.writeText)
            throw Error('CLIPBOARD_UNAVAILABLE');
        await navigator.clipboard.writeText(requestText.value);
        get('organization-copy-status').textContent = 'Request copied. You choose where and when to send it.';
    }
    catch {
        requestText.focus();
        requestText.select();
        get('organization-copy-status').textContent = 'Copy is unavailable. The request is selected so you can copy it manually.';
    } })();
});
window.addEventListener('storage', event => { if (event.key === ORGANIZATION_STORAGE_KEY || event.key === null) {
    savedNotice();
    feedback.textContent = 'Saved organization setup changed in another tab. Your unsaved form choices have been kept.';
} });
setupCommercialRequest();
