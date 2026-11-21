import {readFileSync,writeFileSync} from 'node:fs';
import {LEGAL_DOCUMENTS,footerHtml,renderLegalDocument} from '../.build/src/legal/documents.js';
import {headerBrandLink} from '../.build/src/brand/identity.js';
for(const doc of LEGAL_DOCUMENTS)writeFileSync(`public/${doc.slug}.html`,renderLegalDocument(doc));
for(const path of ['public/iceo.html','public/account.html','public/organizations.html','public/wallet.html']){
 const html=readFileSync(path,'utf8');const matches=html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/gu);if(matches?.length!==1)throw Error('LEGAL_FOOTER_TARGET_INVALID');
 const header=html.match(/(<header class="masthead(?: site-header)?">[\s\S]*?)<a href="\/" class="brand(?: brand-header)?" aria-label="DLKT INFO home">[\s\S]*?<\/a>/u);
 if(!header)throw Error('HEADER_BRAND_TARGET_INVALID');
 const updated=html.replace(header[0],header[1]+headerBrandLink()).replace(matches[0],footerHtml()).replace(/<body(?![^>]*\bid=)/u,'<body id="top"').replace('<header class="masthead">','<header class="masthead site-header">').replace(/<link rel="stylesheet" href="\/header.css">/gu,'').replace('<link rel="stylesheet" href="/iceo.css">','<link rel="stylesheet" href="/iceo.css"><link rel="stylesheet" href="/header.css">');writeFileSync(path,updated);
}
