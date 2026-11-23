import assert from 'node:assert/strict';
import test from 'node:test';
import {NEWS_SOURCE_LANGUAGES,NEWS_PUBLISHERS,NEWS_DISCOVERY_INDEXES,sourceLanguage,sourcePublicationContext} from '../.build/src/iceo/news-sources.js';
import {classifyNewsHeadline,headlineDiscoveryPriority} from '../.build/src/iceo/editorial-categories.js';
import {readPublisherNewsCandidates,readNewsArticleMetadata,matchingNewsHeadline,validateNewsCandidate,discoverNews} from '../.build/src/iceo/news-discovery.js';

const now=Date.parse('2026-11-21T22:00:00Z'),date='2026-11-21T21:30:00.000Z';
const url=language=>`https://www.france24.com/${language}/20261121-fixture`;
const dwUrl=language=>`https://www.dw.com/${language}/fixture/a-12345678`;
const source=language=>{const index=NEWS_DISCOVERY_INDEXES.find(row=>row.id===`france24-${language}-news`);assert.ok(index);return index;};
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const rss=(index,rows,language=index.language)=>`<rss xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${escape(index.feedTitle)}</title><link>${index.feedHome}</link><atom:link href="${index.url}" rel="self"/><language>${language}</language>${rows.map(row=>`<item><title>${escape(row.title)}</title><link>${escape(row.sourceUrl)}</link><pubDate>Sat, 21 Nov 2026 21:30:00 GMT</pubDate><description>Excluded publisher body</description><enclosure url="https://images.invalid/asset"/></item>`).join('')}</channel></rss>`;
const html=(row,overrides={})=>`<html><head><link rel="canonical" href="${row.sourceUrl}"><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',headline:row.title,url:row.sourceUrl,datePublished:date,...overrides})}</script></head><body>Excluded publisher body</body></html>`;

test('reviewed source tags cover observed edition paths and never infer language or event place from a host alone',()=>{
  assert.equal(NEWS_PUBLISHERS.length,74);assert.equal(NEWS_SOURCE_LANGUAGES.length,33);assert.ok(Object.isFrozen(NEWS_SOURCE_LANGUAGES));
  for(const [path,language] of [['de','de'],['pt-br','pt-BR'],['pt-002','pt-002'],['zh','zh-Hans'],['zh-hant','zh-Hant'],['fa-af','fa-AF'],['fa-ir','fa-IR'],['ro','ro'],['sw','sw'],['ur','ur']]){
    assert.equal(sourceLanguage(dwUrl(path)),language);
    const provenance=sourcePublicationContext(dwUrl(path));assert.equal(provenance.publisherCountryCode,'DE');assert.equal(provenance.countries,undefined);assert.equal(provenance.city,undefined);
  }
  assert.equal(sourceLanguage(url('es')),'es');assert.equal(sourceLanguage(url('ar')),'ar');
  for(const value of ['https://www.dw.com/fixture/a-12345678','https://www.dw.com/de-extra/fixture','https://www.dw.com/pt/fixture','https://www.dw.com/arbitrary/fixture','https://www.dw.com/zz/fixture','https://www.dw.com.attacker.invalid/de/story','http://www.dw.com/de/story','https://user@www.dw.com/de/story'])assert.equal(sourceLanguage(value),null,value);
  assert.equal(sourceLanguage('https://pt.globalvoices.org/2026/11/21/fixture/'),null);
  assert.equal(NEWS_DISCOVERY_INDEXES.some(row=>row.publisherId==='dw'&&row.format==='rss'),false);
  assert.deepEqual(NEWS_DISCOVERY_INDEXES.filter(row=>row.publisherId==='dw').map(row=>row.language),['ro','de','fr','es','ar']);
});

const subjects={
  es:{
    world:'Los países firman un acuerdo de alto el fuego',business:'Los bancos anuncian sus resultados trimestrales',
    technology:'La empresa lanza un nuevo software de inteligencia artificial',money:'El costo de vida afecta al presupuesto familiar',
    health:'Una nueva vacuna supera los ensayos clínicos',sport:'El equipo de fútbol gana la final',gaming:'Nintendo anuncia un nuevo videojuego',
    culture:'La orquesta inaugura un festival de música',shopping:'Comienzan las rebajas de Black Friday',travel:'Una nueva ruta conecta dos aeropuertos',
    work:'Los trabajadores protestan contra los despidos',education:'Las universidades ofrecen nuevas becas',family:'El permiso parental se amplía para las familias',
    science:'Los científicos descubren nuevas galaxias',environment:'Los glaciares retroceden por el cambio climático',
    'public-affairs':'El parlamento aprueba una nueva ley','digital-life':'Un ciberataque provoca una filtración de datos',
    food:'Los restaurantes adoptan nuevas medidas de seguridad alimentaria',housing:'Los inquilinos protestan por los alquileres',weather:'Las inundaciones obligan a evacuar varias ciudades',
  },
  ar:{
    world:'الدول تتوصل إلى اتفاق لوقف إطلاق النار',business:'البنوك تعلن ارتفاع أسعار الفائدة',
    technology:'شركة تطلق برنامجا جديدا للذكاء الاصطناعي',money:'ارتفاع تكلفة المعيشة يضغط على ميزانية الأسرة',
    health:'لقاح جديد ينجح في تجربة سريرية',sport:'فريق كرة القدم يفوز بالنهائي',gaming:'نينتندو تعلن موعد إصدار ألعاب الفيديو',
    culture:'مهرجان السينما يفتح أبوابه للجمهور',shopping:'تخفيضات تجارية في الجمعة السوداء',travel:'افتتاح خط جديد للسكك الحديدية',
    work:'تراجع البطالة مع زيادة فرص التوظيف',education:'الجامعات تقدم منح دراسية جديدة',family:'إجازة الوالدين تدعم تربية الأطفال',
    science:'علماء يكتشفون ثقبا أسود في الفضاء',environment:'الطاقة المتجددة تخفض انبعاثات الكربون',
    'public-affairs':'البرلمان يقر قانونا جديدا','digital-life':'هجوم سيبراني يؤدي إلى تسريب البيانات',
    food:'وصفات الطبخ الجديدة تراعي حساسية الطعام',housing:'أزمة السكن تؤدي إلى ارتفاع الإيجار',weather:'فيضانات واسعة بعد عاصفة شديدة',
  },
  de:{
    world:'Die Länder vereinbaren einen Waffenstillstand',business:'Banken veröffentlichen neue Quartalszahlen',
    technology:'Neue Software nutzt künstliche Intelligenz',money:'Die Lebenshaltungskosten steigen weiter',
    health:'Ein neuer Impfstoff schützt Patienten',sport:'Die Mannschaft gewinnt das Fußballspiel',gaming:'Nintendo stellt neue Videospiele vor',
    culture:'Ein neues Museum zeigt Kunst aus aller Welt',shopping:'Neue Rabatte zum Black Friday',travel:'Die Flughäfen melden mehr Flüge',
    work:'Arbeitnehmer protestieren gegen Entlassungen',education:'Universitäten vergeben neue Stipendien',family:'Mehr Elternzeit und Kinderbetreuung angekündigt',
    science:'Forscher entdecken neue Galaxien',environment:'Erneuerbare Energien stärken den Klimaschutz',
    'public-affairs':'Der Bundestag beschließt ein neues Gesetz','digital-life':'Ein Cyberangriff verursacht ein Datenleck',
    food:'Neue Rezepte für Restaurants',housing:'Die Mieten für Wohnungen steigen',weather:'Ein Erdbeben erschüttert die Region',
  },
  'pt-br':{
    world:'Os países assinam um acordo de cessar-fogo',business:'Bancos divulgam resultados trimestrais',
    technology:'Empresa lança software de inteligência artificial',money:'O custo de vida pressiona o orçamento familiar',
    health:'Nova vacina avança nos ensaios clínicos',sport:'O futebol conquista novos torcedores',gaming:'Nintendo anuncia novos jogos eletrônicos',
    culture:'Festival de cinema abre suas portas',shopping:'Descontos de Black Friday começam hoje',travel:'Nova rota conecta dois aeroportos',
    work:'Trabalhadores protestam contra demissões',education:'Universidades ampliam bolsas de estudo',family:'Licença parental ajuda cuidados infantis',
    science:'Cientistas descobrem novas galáxias',environment:'Energias renováveis reduzem emissões de carbono',
    'public-affairs':'Parlamento aprova uma nova lei','digital-life':'Ciberataque causa vazamento de dados',
    food:'Restaurantes discutem segurança alimentar',housing:'Aluguéis afetam o acesso à moradia',weather:'Enchentes atingem várias cidades',
  },
};
test('Spanish Arabic German and Portuguese subjects classify without translating original titles',()=>{
  const failures=[];
  for(const [language,fixtures] of Object.entries(subjects))for(const [category,title]of Object.entries(fixtures)){
    const sourceUrl=language==='de'||language==='pt-br'?dwUrl(language):url(language);
    const actual=classifyNewsHeadline(title,sourceUrl);if(actual!==category)failures.push({language,title,expected:category,actual});
  }
  assert.deepEqual(failures,[]);
});
test('localized classification retains unknowns and avoids stock, school, fiction and Arabic word-prefix errors',()=>{
  for(const [language,title,category]of [
    ['es','Wall Street cae por las acciones vinculadas a la inteligencia artificial','business'],
    ['es','La fusión de galaxias sorprende a los científicos','science'],
    ['es','Las escuelas anuncian su fusión para ayudar a estudiantes','education'],
    ['es','Una película de ciencia ficción llega al cine','culture'],
    ['es','La película japonesa «カナ» llega al cine','culture'],
    ['es','Se abren caminos inesperados',null],
    ['ar','الوقود الأحفوري يهدد مستقبل المناخ','environment'],
    ['ar','وصفات الطبخ تتنوع في المطاعم','food'],
    ['ar','البرلمان يعلن تبني قانون جديد','public-affairs'],
    ['ar','فيلم جديد يروي قصة الحرب','culture'],
    ['ar','تتغير التفاصيل مع مرور الوقت',null],
    ['de','Die Kernfusion fasziniert Forscher','science'],
    ['de','Neue Entwicklungen sorgen für Gespräche',null],
    ['pt-br','A fusão de galáxias revela novos segredos','science'],
    ['pt-br','A fusão de bancos aumenta os lucros','business'],
    ['pt-br','Novos caminhos se abrem',null],
  ])assert.equal(classifyNewsHeadline(title,['de','pt-br'].includes(language)?dwUrl(language):url(language)),category,title);
});
test('new-language discovery signals keep stronger developments ahead without changing evidence meaning',()=>{
  for(const [title,category,expected]of [
    ['Acuerdo de alto el fuego tras negociaciones','world',2],['اتفاق جديد لوقف إطلاق النار','world',2],
    ['Die Länder vereinbaren einen Waffenstillstand','world',2],['Os países assinam um acordo de cessar-fogo','world',2],
    ['La empresa lanza un nuevo producto','technology',1],['دراسة تكشف نتائج جديدة','science',1],
    ['Forscher entdecken neue Galaxien','science',1],['Bancos divulgam resultados trimestrais','business',1],
  ])assert.equal(headlineDiscoveryPriority(title,category),expected,title);
});
test('registered Spanish regional RSS and Arabic RSS retain exact five-field candidates and original publication metadata',()=>{
  for(const [language,feedLanguage]of [['es','es-419'],['ar','ar']]){
    const index=source(language),row={sourceUrl:url(language),title:subjects[language].technology};
    const candidates=readPublisherNewsCandidates(rss(index,[row],feedLanguage),index,now);assert.equal(candidates.length,1);
    const candidate=candidates[0];assert.equal(candidate.title,row.title);assert.equal(candidate.category,'technology');
    assert.deepEqual(Object.keys(candidate).sort(),['category','indexedAt','publisher','sourceUrl','title']);assert.deepEqual(validateNewsCandidate(candidate,now),candidate);
    const verified=readNewsArticleMetadata(html(row),candidate,candidate.sourceUrl,now);assert.equal(verified.title,row.title);assert.equal(verified.date,date);
    assert.equal(readNewsArticleMetadata(html(row,{datePublished:undefined,dateModified:date}),candidate,candidate.sourceUrl,now),null);
    assert.equal(readNewsArticleMetadata(html(row,{datePublished:'2026-11-19T21:30:00Z'}),candidate,candidate.sourceUrl,now),null);
    assert.throws(()=>readPublisherNewsCandidates(rss(index,[row],'en'),index,now),/IDENTITY_INVALID/);
    assert.throws(()=>readPublisherNewsCandidates(rss(index,[row]),{...index,language:'en'},now),/NOT_REGISTERED/);
    const wrongEdition={...row,sourceUrl:url(language==='ar'?'es':'ar')};assert.equal(readPublisherNewsCandidates(rss(index,[wrongEdition]),index,now).length,0);
  }
});
test('unknown new-language topics remain candidates without fabricated subject or translated summary',()=>{
  for(const [language,title]of [['es','Se abren caminos inesperados'],['ar','تتغير التفاصيل مع مرور الوقت']]){
    const index=source(language),rows=readPublisherNewsCandidates(rss(index,[{sourceUrl:url(language),title}]),index,now);
    assert.equal(rows.length,1);assert.equal(rows[0].category,null);assert.equal(rows[0].title,title);assert.equal(rows[0].summary,undefined);
  }
});
test('title matching protects Spanish German Portuguese Arabic negations and Arabic-script numeric conditions',()=>{
  for(const [positive,negative]of [
    ['El gobierno aprueba una nueva ley para los estudiantes','El gobierno no aprueba una nueva ley para los estudiantes'],
    ['Die Regierung beschließt ein neues Gesetz für Schulen','Die Regierung beschließt kein neues Gesetz für Schulen'],
    ['O governo aprova uma nova lei para os estudantes','O governo não aprova uma nova lei para os estudantes'],
    ['الحكومة تقر قانونا جديدا لدعم الطلاب في المدارس','الحكومة لم تقر قانونا جديدا لدعم الطلاب في المدارس'],
    ['الحكومة تقر قانونا جديدا لدعم الطلاب في المدارس','الحكومة لَمْ تقر قانونا جديدا لدعم الطلاب في المدارس'],
    ['الحكومة تدعم ٢٠ مدرسة جديدة في المدن','الحكومة تدعم ٢٠٠ مدرسة جديدة في المدن'],
    ['El gobierno aprobará una nueva ley para todas las escuelas','El gobierno jamás aprobará una nueva ley para todas las escuelas'],
    ['الحكومة تؤكد أن القرار نافذ في جميع أنحاء البلاد','الحكومة تؤكد أن القرار غير نافذ في جميع أنحاء البلاد'],
    ['Die Regierung plant eine Änderung der Gesetze für alle Schulen','Die Regierung plant keinerlei Änderung der Gesetze für alle Schulen'],
  ])assert.equal(matchingNewsHeadline(positive,negative),false,negative);
  const arabic=subjects.ar.technology;assert.equal(matchingNewsHeadline(arabic,arabic),true);
});
test('reviewed editions without token rules require exact original headlines including Romanian and Russian negations',()=>{
  for(const [language,title,changed]of [
    ['ro','Guvernul aproba o noua lege pentru elevii din scoli','Guvernul nu aproba o noua lege pentru elevii din scoli'],
    ['ru','Правительство одобрило новый закон для студентов в школах','Правительство не одобрило новый закон для студентов в школах'],
  ]){
    const sourceUrl=dwUrl(language),row={sourceUrl,title,publisher:'DW',indexedAt:new Date(now).toISOString(),category:classifyNewsHeadline(title,sourceUrl)};
    assert.equal(matchingNewsHeadline(title,title+' - DW','DW',language),true);
    assert.equal(matchingNewsHeadline(title,changed,'DW',language),false);
    assert.equal(readNewsArticleMetadata(html(row),row,sourceUrl,now)?.title,title);
    assert.equal(readNewsArticleMetadata(html(row,{headline:changed}),row,sourceUrl,now),null);
  }
});
test('new publisher indexes keep the original-page gate and shared HTTP budget even when feeds succeed',async()=>{
  const index=source('ar'),row={sourceUrl:url('ar'),title:subjects.ar.technology},requests=[];
  const fetcher=async value=>{
    const target=String(value);requests.push(target);
    if(target===index.url)return new Response(rss(index,[row]),{headers:{'content-type':'application/rss+xml'}});
    if(target===row.sourceUrl)return new Response('Access denied',{status:403});
    return new Response('Unavailable',{status:503});
  };
  const results=await discoverNews(fetcher,now,[],undefined,{frontpageHighlights:false,maxArticleRequests:1});
  assert.equal(requests.filter(value=>value===row.sourceUrl).length,1);assert.equal(results.flatMap(result=>result.cards).length,0);
});
