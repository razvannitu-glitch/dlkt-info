import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEvidenceCard,classifyNewsSubject} from '../.build/src/iceo/news-taxonomy.js';

// Public original metadata from the first verified ProSport cards; no invented date or source fields.
const observed=[
 {
  title:'Lovitură de teatru! Anunț despre venirea lui Mirel Rădoi la „U” Cluj, noul El Dorado din Superliga',
  sourceUrl:'https://www.prosport.ro/fotbal-intern/superliga/anunt-venire-mirel-radoi-u-cluj-20576183',
  sourceIds:['news-unclassified'],topic:'other',
  articleSubject:{basis:'publisher-jsonld',sections:['Fotbal Intern','Liga 1','Superliga'],
   keywords:['Mirel Radoi','Radu Constantea','cristiano bergodi','mirel radoi universitatea cluj'],
   articleUrl:'https://www.prosport.ro/fotbal-intern/superliga/anunt-venire-mirel-radoi-u-cluj-20576183'},
 },
 {
  title:'Primarul Ploieştiului: „Conducerea vremelnică a Petrolului ne propune o afacere 100% penală!”',
  sourceUrl:'https://www.prosport.ro/fotbal-intern/superliga/primarul-ploiestiului-conducerea-petrolului-propune-o-afacere-penala-20576050',
  sourceIds:['news-unclassified'],topic:'other',
  articleSubject:{basis:'publisher-jsonld',sections:['Fotbal Intern','Superliga'],
   keywords:['claudiu tudor','claudiu tudor petrolul','mihai politeanu','primar ploiesti'],
   articleUrl:'https://www.prosport.ro/fotbal-intern/superliga/primarul-ploiestiului-conducerea-petrolului-propune-o-afacere-penala-20576050'},
 },
];
const url=observed[0].sourceUrl;
const card=(sections=[],keywords=[])=>({
 title:'Actualizare despre eveniment',sourceUrl:url,sourceIds:['news-unclassified'],topic:'other',
 articleSubject:{basis:'publisher-jsonld',articleUrl:url,sections,keywords},
});

test('both observed ProSport originals use their bound sport sections without changing provenance',()=>{
 for(const original of observed){
  const before=JSON.stringify(original);
  assert.deepEqual(classifyEvidenceCard(original),{category:'15000000',basis:'publisher-metadata'},original.title);
  assert.equal(JSON.stringify(original),before);
 }
});

test('only the three reviewed exact section labels supply the new sport mapping',()=>{
 for(const label of ['Fotbal Intern','Liga 1','Superliga']){
  assert.deepEqual(classifyEvidenceCard(card([label])),{category:'15000000',basis:'publisher-metadata'},label);
  assert.equal(classifyEvidenceCard(card([],[label])),null,'a section-only label is not a keyword: '+label);
 }
 for(const label of ['Fotbal international','Liga 10','Superliga feminina','Liga']){
  assert.equal(classifyEvidenceCard(card([label])),null,label);
 }
});

test('precise sections retain priority and multiple distinct section categories stay ambiguous',()=>{
 assert.deepEqual(classifyEvidenceCard(card(['Fotbal Intern','Superliga'],['Economia'])),{category:'15000000',basis:'publisher-metadata'});
 assert.deepEqual(classifyEvidenceCard(card(['Cultura'],['Sport','Superliga'])),{category:'01000000',basis:'publisher-metadata'});
 assert.deepEqual(classifyEvidenceCard(card(['Economia'],['Sport','Liga 1'])),{category:'04000000',basis:'publisher-metadata'});
 assert.equal(classifyEvidenceCard(card(['Fotbal Intern','Economia'])),null);
 assert.equal(classifyEvidenceCard(card(['Superliga','Cultura'])),null);
});

test('unbound metadata, publisher identity and URL paths cannot supply the new mapping',()=>{
 const unbound=card(['Fotbal Intern','Liga 1','Superliga']);
 unbound.articleSubject.articleUrl=observed[1].sourceUrl;
 assert.equal(classifyEvidenceCard(unbound),null);
 const withoutMetadata=card();delete withoutMetadata.articleSubject;
 assert.equal(classifyEvidenceCard(withoutMetadata),null);
 assert.equal(classifyNewsSubject(withoutMetadata.title,url),null);
 for(const original of observed){
  assert.notEqual(classifyNewsSubject(original.title,original.sourceUrl)?.category,'15000000','headlines remain unchanged');
 }
});
