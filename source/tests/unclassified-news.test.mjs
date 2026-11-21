import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cardContent,copyCard,validCard} from '../.build/src/iceo/card-validation.js';
import {PUBLIC_TOPICS,TOPIC_LABELS} from '../.build/src/iceo/topics.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_TOPICS,classifyEditorialCard} from '../.build/src/iceo/editorial-categories.js';
import {NEWS_UNCLASSIFIED_SOURCE} from '../.build/src/iceo/news-sources.js';
import {DAILY_INTERESTS,RECOMMENDED_DAILY_TOPICS} from '../.build/src/daily/interests.js';
import {rankEditorialCards} from '../.build/src/iceo/editorial-ranking.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {archiveRecordFromRow,captureArchiveRecord,validArchiveCard} from '../.build/src/share/archive.js';

const now=Date.parse('2026-11-21T09:00:00.000Z');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function card(changes={}){
 const identity='https://apnews.com/article/traditional-paper-marbling-67c718a2';
 const value={identity,sourceUrl:identity,title:'A traditional paper marbling gathering opens today',topic:'other',kind:'publication',publisher:'Associated Press',sourceIds:['news-unclassified'],
  date:new Date(now-3_600_000).toISOString(),dateLabel:'Published',observedAt:new Date(now-1000).toISOString(),boundary:'Source-checked publisher metadata; not independent corroboration.',deadline:null,version:null,
  attribution:'Source: Associated Press.',sourceState:'verified',...changes};
 return {...value,id:hash(value.identity).slice(0,24),contentHash:hash(cardContent(value))};
}

test('other is a neutral data topic, not an automatically selected or newly inferred interest',()=>{
 assert.equal(PUBLIC_TOPICS.at(-1),'other');assert.equal(TOPIC_LABELS.other,'Other topics');
 assert.equal(PUBLIC_EDITORIAL_CATEGORIES.length,20);assert.equal(NEWS_UNCLASSIFIED_SOURCE.topic,'other');
 assert.equal(DAILY_INTERESTS.flatMap(interest=>interest.topics).includes('other'),false);
 assert.equal(RECOMMENDED_DAILY_TOPICS.includes('other'),false);
});

test('unclassified source cards preserve identity, revision and copy/archive round-trip',()=>{
 const value=card(),before=JSON.stringify(value);assert.equal(validCard(value),true);assert.equal(validArchiveCard(value),true);
 const current={card:value,validUntil:now+300_000,partial:false};
 const captured=captureArchiveRecord(current,now);
 const restored=archiveRecordFromRow({id:value.id,revision:value.contentHash,card:value,captured_at:captured.capturedAt,source_check_expires_at:captured.sourceCheckExpiresAt,partial:false});
 assert.deepEqual(restored.card,value);assert.deepEqual(copyCard(value),value);assert.equal(JSON.stringify(value),before);
});

test('unknown provenance does not bypass the reviewed publisher, URL, topic or payload boundaries',()=>{
 for(const value of [card({topic:'world'}),card({publisher:'Unreviewed publisher'}),card({sourceIds:['news-unknown']}),card({sourceIds:['news-unclassified','news-world']}),
  card({sourceUrl:'https://apnews.com.evil.example/article/attack'}),card({summary:'Unlicensed body'}),card({byline:'Invented author',licenseUrl:'https://example.com/license'}),card({privateMessage:'private'})])assert.equal(validArchiveCard(value),false);
 assert.equal(validArchiveCard(card({sourceIds:['news-unclassified','editorial-frontpage']})),true);
 assert.equal(validArchiveCard(card({identity:'https://www.nature.com/articles/example',sourceUrl:'https://www.nature.com/articles/example',publisher:'Nature',sourceIds:['news-unclassified','editorial-frontpage']})),false);
});

test('a verified homepage selection retains its signal and can enter the top without a classification',()=>{
 const value=card({sourceIds:['news-unclassified','editorial-frontpage']});
 assert.equal(classifyEditorialCard(value),null);
 const view=rankEditorialCards([value],now)[0];assert.equal(view.category,undefined);assert.equal(view.editorial.classification,'unclassified');
 assert.ok(view.editorial.signals.includes('publisher-frontpage'));assert.match(view.reason,/Other topics/);
 const known=PUBLIC_EDITORIAL_CATEGORIES.flatMap((category,index)=>[0,1].map(copy=>card({identity:`https://apnews.com/article/known-${index}-${copy}`,sourceUrl:`https://apnews.com/article/known-${index}-${copy}`,title:`Publisher observation number ${index} variant ${copy}`,topic:EDITORIAL_CATEGORY_TOPICS[category],sourceIds:[`news-${category}`]})));
 const edition=selectContextualToday([...known,value],{countryCode:null,preferredTopics:[]},now);
 assert.ok(edition.first.some(item=>item.card.id===value.id));
 assert.equal(new Set([...edition.first,...edition.more].map(item=>item.card.id)).size,41);
});

test('unclassified explanatory material remains available in continuation without padding the top',()=>{
 const value=card({title:'A closer look at traditional paper marbling techniques'});
 const edition=selectContextualToday([value],{countryCode:null,preferredTopics:[]},now);
 assert.equal(edition.first.length,0);assert.equal(edition.more.length,1);assert.equal(edition.more[0].card,value);
});
