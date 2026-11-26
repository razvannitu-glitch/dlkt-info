import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {accountText, topicName} from '../.build/src/account/presentation.js';

function harness() {
  let locale = 'en';
  const elements = [];
  class Element {
    children = []; attributes = new Map(); dataset = {}; content = ''; lang = ''; dir = '';
    constructor(tag) { this.tagName = tag; elements.push(this); }
    get textContent() { return this.content + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.content = value; this.children = []; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    append(...children) { this.children.push(...children); }
  }
  const root = new Element('main');
  const document = {
    createElement: tag => new Element(tag),
    getElementById: () => null,
    querySelectorAll(selector) {
      if (selector === 'main.reader-shell, .site-footer') return [root];
      if (selector === '[data-wallet-copy]') return elements.filter(node => node.dataset.walletCopy);
      if (selector === '[data-wallet-ui]') return elements.filter(node => node.attributes.has('data-wallet-ui'));
      return [];
    },
  };
  const source = readFileSync('.build/src/wallet/presentation.js', 'utf8').replace(/^import [^\n]+\n/gmu, '').replace(/^export /gmu, '');
  const api = runInNewContext(source + '\n({walletText,walletCopy,walletNode,applyWalletPresentation});',
    {document, getLocale: () => locale, accountText, topicName, Node: {TEXT_NODE: 3}});
  return {...api, root, create: tag => new Element(tag), setLocale: value => {locale = value;}};
}

test('Wallet copy translates owned status semantics and declares English fallback', () => {
  const ui = harness();
  assert.equal(ui.walletText('Connected', 'ro'), 'Conectat');
  assert.equal(ui.walletText('Save profile', 'ro'), 'Salveaza profilul');
  assert.equal(ui.walletText('Unknown publisher wording', 'ro'), 'Unknown publisher wording');
  assert.equal(ui.walletText('Connected', 'fr'), 'Connected');
  assert.equal(ui.walletText('3 updates retrieved', 'ro'), '3 noutati preluate');
  assert.equal(ui.walletText('Show more matched cards (21)', 'ro'), 'Arata mai multe carduri potrivite (21)');
  const status = '2 matched cards from available checked sources. Local coverage: partial. Interest sources: ready. Missing checks do not mean that nothing happened.';
  assert.match(ui.walletText(status, 'ro'), /2 carduri potrivite.*Acoperire locala: partiala.*Acoperirea intereselor: disponibila/u);
  ui.setLocale('ar');
  ui.applyWalletPresentation();
  assert.equal(ui.root.lang, 'en');
  assert.equal(ui.root.dir, 'ltr');
});

test('Wallet locale changes owned leaves in place without touching unbound source or private payload', () => {
  const ui = harness(), title = ui.create('h3'), actor = ui.create('p');
  title.textContent = 'Connected'; actor.textContent = 'Save profile';
  const button = ui.walletNode('button', 'Connect');
  ui.walletCopy(button, 'Connect', 'Gmail');
  const input = ui.create('input'); input.value = 'ro-RO'; input.checked = true;
  ui.setLocale('ro'); ui.applyWalletPresentation();
  assert.equal(button.textContent, 'Conecteaza');
  assert.equal(button.attributes.get('aria-label'), 'Conecteaza: Gmail');
  assert.equal(title.textContent, 'Connected');
  assert.equal(actor.textContent, 'Save profile');
  assert.equal(input.value, 'ro-RO'); assert.equal(input.checked, true);
  ui.setLocale('en'); ui.applyWalletPresentation();
  assert.equal(button.textContent, 'Connect');
  assert.equal(button.attributes.get('aria-label'), 'Connect: Gmail');
});

test('Private cleared text cannot return after locale change and canonical values never enter attributes', () => {
  const ui = harness(), summary = ui.create('p');
  const privateText = 'Your profile was saved on PRIVATE_DATE (PRIVATE_ZONE).';
  ui.walletCopy(summary, privateText);
  assert.equal([...summary.attributes.values()].some(value => value.includes('PRIVATE')), false);
  ui.walletCopy(summary, '');
  ui.setLocale('ro'); ui.applyWalletPresentation();
  assert.equal(summary.textContent, '');
  assert.equal(summary.attributes.has('data-wallet-ui'), false);
  ui.walletCopy(summary, privateText);
  summary.textContent = ''; // Defensive handling of existing lifecycle clear paths.
  ui.setLocale('en'); ui.applyWalletPresentation();
  assert.equal(summary.textContent, '');
});

test('Successful-save and sign-in links survive locale changes; cleared containers never resurrect them', () => {
  const ui = harness(), feedback = ui.create('p');
  const message = ui.walletNode('span', 'This public source card was saved in this browser. Your private profile was not copied. ');
  const link = ui.walletNode('a', 'Open saved cards in this browser'); link.href = '/#saved';
  feedback.append(message, link);
  ui.setLocale('ro'); ui.applyWalletPresentation();
  assert.equal(feedback.children[1], link); assert.equal(link.href, '/#saved');
  assert.equal(link.textContent, 'Vezi cardurile salvate in browser');
  const notice = ui.walletNode('p', 'Checking connection availability…');
  const signin = ui.walletNode('a', 'Sign in to DLKT'); signin.href = '/account?returnTo=wallet';
  notice.append(signin);
  ui.setLocale('en'); ui.applyWalletPresentation();
  assert.equal(notice.children[0], signin);
  feedback.textContent = ''; notice.textContent = '';
  ui.setLocale('ro'); ui.applyWalletPresentation();
  assert.equal(feedback.textContent, ''); assert.equal(notice.textContent, '');
});
