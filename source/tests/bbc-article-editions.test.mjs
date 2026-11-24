import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStories,storyThreadKey} from '../.build/src/iceo/story-grouping.js';
import {groupStories as browserGroups,storyThreadKey as browserKey} from '../public/story-grouping.js';
import {NewsPageService} from '../.build/src/iceo/news-page.js';
import {validNewsPage} from '../.build/src/iceo/news-page-contracts.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {article,epoch,CorpusMemoryStore,hash} from './fixtures/news-corpus.mjs';

const NOW=Date.parse('2026-11-24T00:16:00.000Z');
const observed={
 title:'Donegal: Pedestrian in his 40s dies in road crash',
 date:'2026-11-23T08:50:10.599Z',
 path:'/news/articles/crgj38le4dz9o',
};
function report(host='www.bbc.com',extra={}){
 const sourceUrl='https://'+host+observed.path;
 const card={...article(1800,{now:NOW}),sourceUrl,identity:sourceUrl,publisher:'BBC',title:observed.title,date:observed.date,
  topic:'other',sourceIds:['news-unclassified'],attribution:'Source: BBC. Open the original publication.',...extra};
 card.id=hash(card.sourceUrl).slice(0,24);card.contentHash=hash(cardContent(card));return card;
}

test('the observed BBC host editions form one group with both original links and checks unchanged',()=>{
 const originals=[report(),report('www.bbc.co.uk',{observedAt:new Date(NOW-300000).toISOString()})],before=JSON.stringify(originals);
 const groups=groupStories(originals);
 assert.equal(groups.length,1);assert.equal(groups[0].basis,'matching-headlines');
 assert.equal(groups[0].related.length,1);
 assert.deepEqual(new Set([groups[0].card,...groups[0].related]),new Set(originals));
 assert.ok(storyThreadKey(originals[0]));assert.equal(storyThreadKey(originals[0]),storyThreadKey(originals[1]));
 assert.equal(browserGroups(originals).length,1);
 for(const card of originals)assert.equal(browserKey(card),storyThreadKey(card));
 assert.equal(JSON.stringify(originals),before,'original publisher URL, title, publication and observation evidence is immutable');
});

test('an explicit publisher article ID is required and generic short-headline thresholds stay conservative',()=>{
 const original=report(),alternatives=[
  report('www.bbc.co.uk',{sourceUrl:'https://www.bbc.co.uk/news/articles/c111111111111',identity:'https://www.bbc.co.uk/news/articles/c111111111111'}),
  report('www.bbc.co.uk',{publisher:'Unreviewed publisher'}),
  report('www.bbc.co.uk',{sourceUrl:'https://www.bbc.co.uk.example.org'+observed.path,identity:'https://www.bbc.co.uk.example.org'+observed.path}),
  report('www.bbc.co.uk',{sourceUrl:'https://www.bbc.co.uk/news/live/crgj38le4dz9o',identity:'https://www.bbc.co.uk/news/live/crgj38le4dz9o'}),
  report('www.bbc.co.uk',{sourceUrl:'https://www.bbc.co.uk'+observed.path+'?edition=other',identity:'https://www.bbc.co.uk'+observed.path+'?edition=other'}),
  report('www.bbc.co.uk',{sourceUrl:'https://www.bbc.co.uk'+observed.path+'#different',identity:'https://www.bbc.co.uk'+observed.path+'#different'}),
  report('www.bbc.co.uk',{sourceUrl:'http://www.bbc.co.uk'+observed.path,identity:'http://www.bbc.co.uk'+observed.path}),
  report('www.bbc.co.uk',{identity:'https://www.bbc.co.uk/news/articles/c222222222222'}),
 ];
 for(const alternate of alternatives){
  assert.equal(groupStories([original,alternate]).length,2,alternate.sourceUrl);
  assert.equal(browserGroups([original,alternate]).length,2,alternate.sourceUrl);
 }
 const unrelated=[report('www.bbc.com',{title:'Daily update'}),report('www.bbc.co.uk',{title:'Daily update',sourceUrl:'https://www.bbc.co.uk/news/articles/c111111111111',identity:'https://www.bbc.co.uk/news/articles/c111111111111'})];
 assert.equal(groupStories(unrelated).length,2);
 const otherTitle=[report('www.bbc.com',{title:'Road closures announced in coastal town'}),report('www.bbc.co.uk',{title:'Road closures announced in coastal town'})];
 assert.equal(groupStories(otherTitle).length,1,'the rule does not hardcode the Donegal headline or article ID');
});

test('a changed headline, original publication time or supplied excerpt cannot borrow the exact edition key',()=>{
 const original=report(),alternatives=[
  report('www.bbc.co.uk',{title:'Donegal: Pedestrian did not die in road crash'}),
  report('www.bbc.co.uk',{date:'2026-11-23T08:50:11.599Z'}),
  report('www.bbc.co.uk',{summary:'Police corrected the location of the collision.'}),
 ];
 for(const alternate of alternatives){
  assert.equal(groupStories([original,alternate]).length,2);
  assert.notEqual(storyThreadKey(original),storyThreadKey(alternate));
  assert.equal(browserKey(alternate),storyThreadKey(alternate));
 }
});

test('the actual news page counts BBC editions once and preserves both attributed originals',async()=>{
 const originals=[report(),report('www.bbc.co.uk')],stored=epoch(originals,[],{now:NOW}),before=JSON.stringify(stored);
 const service=new NewsPageService(new CorpusMemoryStore([stored]),'bbc-editions-regression-test-key-'.repeat(3),()=>NOW+1000);
 const page=await service.read({language:'ro',sourceScope:'all',cityId:null,filter:'all',period:'recent',cursor:null});
 assert.ok(validNewsPage(page,NOW+1000));assert.equal(page.total,1);assert.equal(page.articleTotal,2);assert.equal(page.items.length,1);
 assert.equal(Object.values(page.counts).reduce((sum,count)=>sum+count,0),1);
 const first=page.items[0];assert.equal(first.story.sourceTotal,2);
 assert.deepEqual(new Set([first.card,...first.story.related.map(source=>source.card)].map(card=>card.sourceUrl)),new Set(originals.map(card=>card.sourceUrl)));
 assert.equal(JSON.stringify(stored),before);
});

