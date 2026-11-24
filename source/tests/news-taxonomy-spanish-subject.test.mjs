import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNewsHeadline,classifyEditorialCard,editorialInterestTopic,contradictedHeadlineHints} from '../.build/src/iceo/editorial-categories.js';
import {classifyEvidenceCard,classifyNewsSubject} from '../.build/src/iceo/news-taxonomy.js';

// Exact source-bound public metadata observed in DLKT revision1594/fence1667.
// The older URL slug is not substituted for the liveblog's original current title.
const observed={
  "id": "08eda96f724326f8bfdb1a10",
  "date": "2026-11-23T13:13:16.000Z",
  "kind": "publication",
  "title": "En directo: Moscú acusa a Estonia de acciones hostiles que están \"a punto de desencadenar una guerra abierta\"",
  "topic": "business",
  "identity": "https://www.france24.com/es/europa/20261123-en-directo-zelenski-confirma-que-el-ej%C3%A9rcito-ucraniano-atac%C3%B3-buques-rusos-en-aguas-de-libia",
  "publisher": "France 24",
  "sourceIds": [
    "news-business"
  ],
  "sourceUrl": "https://www.france24.com/es/europa/20261123-en-directo-zelenski-confirma-que-el-ej%C3%A9rcito-ucraniano-atac%C3%B3-buques-rusos-en-aguas-de-libia",
  "observedAt": "2026-11-24T00:04:38.783Z",
  "contentHash": "83cb383dfb7795654763ccd5f476d5ae75134d3d8972cba09ce966e5e57fc950",
  "articleSubject": {
    "basis": "publisher-jsonld",
    "keywords": [
      "Drones",
      "Europa",
      "Guerra en Ucrania",
      "Libia",
      "OTAN",
      "Rusia",
      "Ucrania",
      "Vladimir Putin",
      "Volodímir Zelenski"
    ],
    "sections": [
      "Europa"
    ],
    "articleUrl": "https://www.france24.com/es/europa/20261123-en-directo-zelenski-confirma-que-el-ej%C3%A9rcito-ucraniano-atac%C3%B3-buques-rusos-en-aguas-de-libia"
  }
};
const url='https://www.france24.com/es/europa/20261124-reported-story';
const card=(title,sections=[],keywords=[])=>({
 title,sourceUrl:url,sourceIds:['news-unclassified'],topic:'other',
 articleSubject:{basis:'publisher-jsonld',articleUrl:url,sections,keywords},
});

test('the observed Spanish original uses its exact bound war subject without rewriting provenance',()=>{
 const before=JSON.stringify(observed),subject=classifyEvidenceCard(observed);
 assert.deepEqual(subject,{category:'16000000',basis:'publisher-metadata'});
 assert.equal(JSON.stringify(observed),before);
 assert.notEqual(classifyNewsSubject(observed.title,observed.sourceUrl)?.category,'04000000','hostile actions are not shares');
 assert.equal(classifyNewsHeadline(observed.title,observed.sourceUrl),'world');
});

test('Spanish actions need independent financial context before becoming economy',()=>{
 assert.equal(classifyNewsHeadline('Acciones hostiles contra Estonia',url),null);
 assert.equal(classifyNewsSubject('Acciones hostiles contra Estonia',url),null);
 const retained={...card('Acciones hostiles contra Estonia'),sourceIds:['news-business'],topic:'business'};
 const before=JSON.stringify(retained);
 assert.equal(classifyEvidenceCard(retained),null);
 assert.equal(classifyEditorialCard(retained),null);
 assert.equal(editorialInterestTopic(retained),'other');
 assert.equal(JSON.stringify(retained),before);
 assert.ok(contradictedHeadlineHints(retained.title).includes('business'));

 for(const title of ['Las acciones bursátiles suben','La cotización de las acciones aumenta','Las acciones en bolsa avanzan','Las empresas anuncian inversiones']){
  assert.equal(classifyNewsHeadline(title,url),'business',title);
  assert.equal(classifyNewsSubject(title,url)?.category,'04000000',title);
 }

 const economic={...card('Acciones hostiles coinciden con inversiones'),sourceIds:['news-business'],topic:'business'};
 assert.equal(contradictedHeadlineHints(economic.title).includes('business'),false);
 assert.equal(classifyEvidenceCard(economic)?.category,'04000000');
 assert.equal(classifyEditorialCard(economic)?.category,'business');
 assert.equal(classifyEvidenceCard({...retained,title:'Nueva actualización'})?.category,'04000000','unrelated hints stay untouched');
 assert.equal(classifyNewsSubject('La guerra comercial eleva los aranceles',url)?.category,'04000000');
 assert.equal(classifyNewsSubject('La guerra de precios continúa',url)?.category,'04000000');
});

test('the reviewed war phrase is exact and cannot be inferred from country names, trade-war or fiction tags',()=>{
 assert.equal(classifyEvidenceCard(card('Nueva actualización',[],['Guerra en Ucrania']))?.category,'16000000');
 for(const keywords of [['Ucrania','Rusia'],['Guerra comercial'],['God of War'],['Documental sobre la Guerra en Ucrania']]){
  assert.equal(classifyEvidenceCard(card('Nueva actualización',[],keywords)),null,keywords.join(', '));
 }
 const fiction=card('Una película sobre la guerra en Ucrania llega a los cines',['Cultura'],['Guerra en Ucrania']);
 assert.deepEqual(classifyEvidenceCard(fiction),{category:'01000000',basis:'publisher-metadata'});
 assert.equal(classifyNewsSubject(fiction.title,url)?.category,'01000000');
});

test('precise publisher sections, ambiguous subjects and exact metadata binding retain their boundaries',()=>{
 const precise=card(observed.title,['Economia'],['Guerra en Ucrania']);
 assert.deepEqual(classifyEvidenceCard(precise),{category:'04000000',basis:'publisher-metadata'});
 assert.equal(classifyEvidenceCard(card('Nueva actualización',[],['Guerra en Ucrania','Economia'])),null);
 const unbound=structuredClone(observed);
 unbound.articleSubject.articleUrl='https://www.france24.com/es/europa/20261124-different-original';
 const subject=classifyEvidenceCard(unbound);
 assert.notEqual(subject?.category,'16000000');assert.notEqual(subject?.basis,'publisher-metadata');
});

