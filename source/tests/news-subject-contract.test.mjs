import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validArticleSubject} from '../.build/src/iceo/article-subject.js';
import {cardContent,copyCard,validCard} from '../.build/src/iceo/card-validation.js';
import {validArchiveCard} from '../.build/src/share/archive.js';
import {classifyEvidenceCard} from '../.build/src/iceo/news-taxonomy.js';
const url='https://www.theguardian.com/world/2026/nov/22/reported-story';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const subject=(sections=['Economy'],keywords=[])=>({basis:'publisher-jsonld',articleUrl:url,sections,keywords});
const evidence=(metadata=subject())=>{
 const base={identity:url,title:'Nvidia unveils a new graphics processor',sourceUrl:url,date:'2026-11-22T12:00:00.000Z',dateLabel:'Published',publisher:'The Guardian',deadline:null,version:null,...(metadata?{articleSubject:metadata}:{})};
 return {...base,id:digest(url).slice(0,24),topic:'other',kind:'publication',sourceIds:['news-unclassified'],observedAt:'2026-11-22T12:01:00.000Z',contentHash:digest(cardContent(base)),boundary:'Attributed original headline.',attribution:'Source: The Guardian.',sourceState:'verified'};
};
test('publisher metadata participates in the canonical material revision and copy',()=>{
 const original=evidence(),copy=copyCard(original);
 assert.equal(validCard(original),true);assert.equal(validArchiveCard(original),true);
 assert.deepEqual(copy,original);assert.notEqual(copy.articleSubject.sections,original.articleSubject.sections);
 assert.notEqual(evidence(null).contentHash,original.contentHash);
 assert.equal(validArchiveCard({...original,articleSubject:subject(['Sport'])}),false);
 assert.equal(validArchiveCard({...original,articleSubject:{...original.articleSubject,token:'private'}}),false);
});
test('subject metadata is bounded, canonical, unique and tied to this article',()=>{
 assert.equal(validArticleSubject(subject(),url),true);
 const invalid=[{...subject(),articleUrl:'https://www.theguardian.com/other'}, {...subject(),basis:'title-guess'},
  subject([],[]),subject(['Economy','Economy']),subject(['Sport','Economy']),subject([' Economy']),
  subject(['a'.repeat(81)]),subject(Array.from({length:9},(_,i)=>String(i))),subject([],Array.from({length:13},(_,i)=>String(i).padStart(2,'0'))),
  subject(['<script>']),...([0,9,10,13,127].map(code=>subject(['ab'+String.fromCharCode(code)+'cd']))),subject(['Two  spaces']),{...subject(),private:'hidden'}];
 for(const metadata of invalid){assert.equal(validArticleSubject(metadata,url),false);assert.equal(validCard(evidence(metadata)),false);}
 assert.equal(validCard({...evidence(),kind:'legal-document'}),false);
});
test('an unambiguous canonical publisher section maps to the standard vocabulary',()=>{
 assert.deepEqual(classifyEvidenceCard(evidence()),{category:'04000000',basis:'publisher-metadata'});
 assert.deepEqual(classifyEvidenceCard(evidence(subject(['Sport'],['Economy']))),{category:'15000000',basis:'publisher-metadata'});
 assert.deepEqual(classifyEvidenceCard(evidence(subject([],['Science']))),{category:'13000000',basis:'publisher-metadata'});
 assert.deepEqual(classifyEvidenceCard(evidence(subject(['economy, business and finance']))),{category:'04000000',basis:'publisher-metadata'});
});
test('ambiguous or unrelated metadata retains the existing headline fallback',()=>{
 for(const metadata of [subject(['Economy','Science']),subject([],['Economy','Sport']),subject(['Nvidia']),{...subject(),articleUrl:url+'/other'}]){
  const result=classifyEvidenceCard(evidence(metadata));assert.equal(result?.category,'13000000');assert.notEqual(result?.basis,'publisher-metadata');
 }
 const unknown={...evidence(subject(['__proto__'])),title:'A reported development'};assert.equal(classifyEvidenceCard(unknown),null);
});

test('verified publisher business labels preserve the explicit care-delivery exception',()=>{
 const card={...evidence(subject(['Business'])),title:'Retail medicine expands in neighbourhoods'};
 assert.deepEqual(classifyEvidenceCard(card),{category:'07000000',basis:'headline'});
 assert.equal(classifyEvidenceCard({...card,title:'Retail medicine company reports annual profits and revenue growth'})?.category,'04000000');
});
