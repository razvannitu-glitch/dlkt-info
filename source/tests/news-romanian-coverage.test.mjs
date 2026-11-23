import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNewsSubject,classifyEvidenceCard,classifyLocalCard} from '../.build/src/iceo/news-taxonomy.js';
import {classifyNewsSubject as browserSubject,classifyEvidenceCard as browserEvidence} from '../public/news-taxonomy.js';

const sourceUrl='https://hotnews.ro/controlled-current-report';
const card=(title,extra={})=>({title,sourceUrl,sourceIds:['news-unclassified'],topic:'other',...extra});
const fixtures=[
 ['Ultima săptămână de colectare a deșeurilor voluminoase în Sectorul 6. Unde se găsesc containerele','06000000'],
 ['Deșeuri medicale periculoase descoperite de Garda de Mediu','06000000'],
 ['Momentul în care Călin Georgescu iese din arest, în uralele susținătorilor: „Dumnezeu m-a născut om liber și liber voi rămâne”','02000000'],
 ['Schimbări majore la vârful DNA, anunțate de procurorul șef Viorel Cerbu, după șase luni de mandat','02000000'],
 ['Procurorul general indică cinci domenii cu rezultate slabe','02000000'],
 ['Curtea de Apel București a respins contestația DIICOT','02000000'],
 ['Cercetătorii au obținut în premieră cartofi crescuți în sol precum cel de pe Lună','13000000'],
 ['Alegerile de duminică din Spania sunt un referendum pentru Pedro Sánchez','11000000'],
 ['George Simion anunță un raport privind anularea alegerilor','11000000'],
 ['Cei doi politicieni care au intervenit personal ca Jensen Huang să revină la șefia Nvidia','11000000'],
 ['De când ar putea fi aplicată viitoarea lege a salarizării. Ministrul Muncii explică','09000000'],
 ['Sindicatele cer majorarea salariului minim','09000000'],
 ['Temperaturile scad abrupt în București. Prognoza specială pentru Capitală','17000000'],
 ['Clasa medie și tinerii sunt prezenți masiv la pelerinajele la biserici','12000000'],
 ['Vremea se primește ca dar și se întoarce lui Dumnezeu ca rod','12000000'],
 ['Bombă de aviație de 50 kg, descoperită în timpul unor săpături. Au intervenit pirotehniștii','03000000'],
];
test('observed Romanian reporting keeps its real subject across inflected forms and browser projection',()=>{
 for(const [title,expected] of fixtures){
  const original=Object.freeze(card(title)),before=JSON.stringify(original);
  assert.equal(classifyEvidenceCard(original)?.category,expected,title);
  assert.equal(browserEvidence(original)?.category,expected,title+' browser');
  assert.equal(classifyLocalCard({kind:'local-news',title,sourceUrl,news:{title,url:sourceUrl}})?.category,expected,title+' local');
  assert.equal(JSON.stringify(original),before,'classification must not rewrite evidence');
 }
});
test('publisher compound sections support specific subjects while ambiguity and URL binding remain protected',()=>{
 const metadata=sections=>({basis:'publisher-jsonld',articleUrl:sourceUrl,sections,keywords:[]});
 for(const sections of [['Actualitate, Politic'],['Actualitate; Politic'],['Actualitate | Politic']]){
  const original=card('O nouă decizie anunțată astăzi',{articleSubject:metadata(sections)});
  assert.equal(classifyEvidenceCard(original)?.category,'11000000');
  assert.equal(classifyEvidenceCard(original)?.basis,'publisher-metadata');
  assert.deepEqual(browserEvidence(original),classifyEvidenceCard(original));
 }
 assert.equal(classifyEvidenceCard(card('O nouă decizie',{articleSubject:metadata(['Politic, Sport'])})),null);
 assert.equal(classifyEvidenceCard(card('O nouă decizie',{articleSubject:{...metadata(['Politic']),articleUrl:'https://hotnews.ro/a-different-report'}})),null);
 assert.equal(classifyEvidenceCard(card('O nouă decizie',{articleSubject:metadata(['arts, culture, entertainment and media'])}))?.category,'01000000');
});
test('unknown and metaphorical titles cannot be used to fill a category quota',()=>{
 for(const title of ['DNA','Un accident fericit','O surpriză de proporții','Compania și-a desemnat noul președinte']){
  assert.equal(classifyNewsSubject(title,sourceUrl),null,title);
  assert.equal(browserSubject(title,sourceUrl),null,title+' browser');
 }
 assert.equal(classifyNewsSubject('Pirotehniștii pregătesc artificiile pentru festivalul de muzică',sourceUrl)?.category,'01000000');
 assert.equal(classifyNewsSubject('Restaurarea bisericii intră în programul muzeului',sourceUrl)?.category,'01000000');
 assert.equal(classifyNewsSubject('Actorul prezintă rezultatele financiare și profitul companiei',sourceUrl)?.category,'04000000');
});
test('explicit Romanian family publisher section identifies parenting without inferring from an article slug',()=>{
 const url='https://www.digi24.ro/magazin/stil-de-viata/familie/nu-am-mancat-eu-prajiturile-4044977';
 assert.equal(classifyNewsSubject('De ce primele minciuni spuse de copii pot fi un semn bun',url)?.category,'14000000');
 assert.equal(classifyNewsSubject('O surpriză de proporții','https://hotnews.ro/familie'),null);
});
