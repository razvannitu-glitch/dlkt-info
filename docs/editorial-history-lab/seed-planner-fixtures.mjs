// CI-only synthetic fixture seeder. No live evidence or source requests.
import {writeFileSync} from 'node:fs';
import {knowledgeRightsCandidates} from '../../source/tests/fixtures/knowledge-rights-candidates.mjs';
import {validKnowledgeCard,knowledgeRightsForCard,knowledgeEditorialPayload} from '../../source/.build/src/iceo/knowledge.js';
import {knowledgeContentDigest} from '../../source/.build/src/share/knowledge-resolution.js';

const output=process.argv[2];
if(!output||process.argv.length!==3)throw Error('SYNTHETIC_FIXTURE_PATH_REQUIRED');
const base=knowledgeRightsCandidates.find(c=>c.id==='dlkt-elsewhere-nsw-fuelcheck');
if(!base)throw Error('LAB_BASE_FIXTURE_MISSING');
const marker='DLKT SYNTHETIC PLANNER SIMULATION',languages=['en','ro','it'],now=Date.now();
const card={...base,revision:1000001,
  reviewedAt:new Date(now-3600000).toISOString(),reviewBy:new Date(now+2*86400000).toISOString(),
  topic:Object.fromEntries(languages.map(l=>[l,marker])),
  copy:Object.fromEntries(languages.map(l=>[l,{title:marker,explanation:marker,connection:marker}]))};
delete card.publishAt;
if(!validKnowledgeCard(card))throw Error('LAB_SYNTHETIC_CARD_INVALID');
const rights=knowledgeRightsForCard(card);
if(!rights)throw Error('LAB_SYNTHETIC_RIGHTS_MISSING');
const identity={id:card.id,revision:card.revision,digest:knowledgeContentDigest(card),payload:knowledgeEditorialPayload(card),
  sourceUrl:card.source.url,policyUrl:rights.policyUrl,reviewedAt:card.reviewedAt,reviewBy:card.reviewBy};
const names=['scope','drift','held','expiry','boundary'];
const candidates=Object.fromEntries(names.map(name=>[name,{
  id:'lab-planner-'+name,revision:identity.revision,digest:identity.digest,
  sourceUrl:'https://example.invalid/source/planner-'+name,policyUrl:'https://example.invalid/policy/planner-'+name}]));
writeFileSync(output,JSON.stringify({kind:'synthetic-planner-fixture-not-authority',identity,candidates})+'\n',{flag:'wx',mode:0o600});
// All fields are fixed synthetic names, canonical hex, and invalid test URLs.
const quote=s=>"'"+s.replaceAll("'","''")+"'";
process.stdout.write('BEGIN;\n'+Object.values(candidates).map(c=>
  'INSERT INTO dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url) VALUES('+
  [quote(c.id),String(c.revision),quote(c.digest),quote(c.sourceUrl),quote(c.policyUrl)].join(',')+');').join('\n')+'\nCOMMIT;\n');
