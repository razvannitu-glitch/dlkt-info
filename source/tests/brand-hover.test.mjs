import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync('public/iceo.css','utf8');
test('button, footer and legal navigation hover use the exact DLKT coral and readable black text',()=>{assert.match(css,/@media \(hover:hover\) and \(pointer:fine\)/u);assert.match(css,/:root :is\(button,a\.source-link,\.more-menu a,\.reader-more>summary,\.footer-link,\.legal-toc a\):not\(:disabled\):not\(\[aria-disabled="true"\]\):hover\{\s*background-color:var\(--coral\);\s*border-color:var\(--coral\);\s*color:var\(--black\);/u);assert.match(css,/--coral:#f66061/u);});
test('primary source actions have a deliberate hover override without changing other buttons',()=>{assert.match(css,/:root :is\(\.card-content>a\.source-link,\.card-actions>a\.source-link\):not\(:disabled\):not\(\[aria-disabled="true"\]\):hover\{background-color:var\(--black\);border-color:var\(--black\);color:var\(--white\)\}/u);assert.match(css,/:root :is\(#discovery-cards,#cards,#daily-cards,#local-cards\)>\.info-card :is\(button,a\):not\(:disabled\):hover\{background:var\(--card-hover\)!important/u);assert.equal((css.match(/:hover\{/g)||[]).length,3);});
