import {parseArcubAgenda} from '../../.build/src/local/arcub.js';

// Reconstructed minimal source structure, not a claim of live availability.
// Header/OG distinction observed in public workflow45726653109.
export const ARCUB_PHOTO_ROWS=Object.freeze([
 {title:'Muzeul Copiilor | Magia Crăciunului - patru experiențe interactive pentru întreaga familie',
  url:'https://arcub.ro/eveniment/muzeul-copiilor-magia-craciunului-patru-experiente-interactive-pentru-intreaga-familie',
  image:'https://arcub.ro/img/15a05216-5dbc-408e-9981-070a02d379aa/foto-1.jpeg?fm=webp&q=85&fit=crop&crop=1600%2C899%2C0%2C33&s=577f2b12cfc406e441c174041dec202a'},
 {title:'România – identitate prin tradiție',url:'https://arcub.ro/eveniment/romania-identitate-prin-traditie',
  image:'https://arcub.ro/img/c21bc9d8-4e6d-40ca-9123-5e1dd95a1bb5/whatsapp-image-2026-11-19-at-12-23-31.jpeg?crop=1600%2C901%2C0%2C149&fit=crop&fm=webp&q=85&s=018ae6fe7984d9179acf77e045a0d83c'},
]);
export const ARCUB_GENERIC_IMAGE='https://arcub.ro/img/aa956136-95fe-4c72-acd5-0e0639d08984/1200x630.jpg?fm=jpg&q=85&fit=crop&w=900&h=470&crop=%2C%2C%2C&s=e6dea77b832e80024c97d96e337a3b96';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function arcubPhotoDocument(row=ARCUB_PHOTO_ROWS[0]){
 return '<html><head><meta property="og:title" content="'+escape(row.title+' | ARCUB')+'"><meta property="og:image" content="'+escape(ARCUB_GENERIC_IMAGE)+'"></head><body><header class="page-header with-bg tall"><picture><img class="bg" src="'+escape(row.image)+'" alt="" width="1600" height="899"></picture><div class="phead"><h1 class="title">'+escape(row.title)+'</h1></div></header></body></html>';
}
export function arcubPhotoFixture(now){
 const checkedAt=new Date(now).toISOString();
 const body=arcubPhotoAgendaDocument();
 const parsed=parseArcubAgenda({body,checkedAt},now);
 return {cards:parsed.cards,coverage:[{domain:'events',state:'partial',checkedAt,sourceUrl:'https://arcub.ro/agenda',note:'Controlled source-photo fixture; not a live event check.'}]};
}
export const arcubPhotoArticle=card=>({id:card.id,revision:card.context.documentHash,sourceUrl:card.sourceUrl,title:card.title,publisher:card.publisher,publishedAt:'',documentKind:'local-event',validUntil:Date.parse(card.validTo)});

export function arcubPhotoAgendaDocument(rows=ARCUB_PHOTO_ROWS){return '<html><body>'+rows.map(row=>'<div class="pgrid-item"><a href="'+escape(row.url)+'"><h3>'+escape(row.title)+'</h3><div class="meta"><span>26 noiembrie – 9 decembrie 2026</span><span>ARCUB – Sala Lahovari</span></div></a></div>').join('')+'</body></html>';}
export function arcubPhotoDetailDocument(row=ARCUB_PHOTO_ROWS[0]){
 const fields='<table class="feat"><tr><td class="lbl">Când</td><td class="val">26 noiembrie – 9 decembrie 2026</td></tr><tr><td class="lbl">Unde</td><td class="val">ARCUB – Sala Lahovari</td></tr></table><div class="content">Program: 26 noiembrie – 9 decembrie 2026.</div>';
 return arcubPhotoDocument(row).replace('</h1></div></header>','</h1>'+fields+'</div></header>');
}
