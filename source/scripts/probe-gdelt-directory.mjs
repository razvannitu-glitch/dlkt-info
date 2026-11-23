import {writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {collectGdeltDirectoryOnce} from '../.build/src/iceo/gdelt-directory.js';

if(!process.env.GITHUB_ACTIONS||!process.env.RUNNER_TEMP)throw Error('ICEO_GDELT_OPERATOR_RUN_ONLY');
const result=await collectGdeltDirectoryOnce(fetch,Date.now());
const artifact={
 format:'iceo-gdelt-origin-proposals-1',
 attribution:'GDELT Project https://www.gdeltproject.org/',
 status:'discovery-only-not-activated',
 checkedAt:result.checkedAt,
 feedItems:result.feedItems,
 uniqueOrigins:result.uniqueOrigins,
 previouslyIndexedOrigins:result.previouslyIndexedOrigins,
 duplicateOrigins:result.duplicateOrigins,
 invalidItems:result.invalidItems,
 deferredCapacity:result.deferredCapacity,
 rejections:result.rejections,
 proposals:result.proposals.map(value=>({
  id:value.candidate.id,
  origin:value.candidate.origin,
  label:value.candidate.name,
  status:value.candidate.status,
  scope:value.candidate.scope,
  rights:value.candidate.rights,
  evidenceIndex:value.discoveryIndex,
  recordReference:value.recordReference,
  observedAt:value.observedAt,
  admission:value.admission,
 })),
};
const file=join(process.env.RUNNER_TEMP,'iceo-gdelt-candidates.json');
writeFileSync(file,JSON.stringify(artifact,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('ICEO_GDELT_ONE_SHOT_AUDIT',JSON.stringify({
 checkedAt:result.checkedAt,feedItems:result.feedItems,distinctOrigins:result.uniqueOrigins,
 known:result.previouslyIndexedOrigins,duplicates:result.duplicateOrigins,invalid:result.invalidItems,
 deferred:result.deferredCapacity,proposed:result.proposals.length,activationAllowed:false,
}));
if(process.env.GITHUB_STEP_SUMMARY){
 const summary=[
  '## ICEO GDELT directory probe',
  '',
  'Research-only observation from the GDELT GAL RSS. No source was activated, and no content was republished.',
  '',
  '| Measure | Observed |',
  '|---|---:|',
  '| Article URLs listed | '+result.feedItems+' |',
  '| Distinct source origins | '+result.uniqueOrigins+' |',
  '| Already indexed source origins | '+result.previouslyIndexedOrigins+' |',
  '| Candidate origins queued for manual review | '+result.proposals.length+' |',
  '| Duplicate origins in this sample | '+result.duplicateOrigins+' |',
  '| Rejected unsafe/invalid items | '+result.invalidItems+' |',
  '| Deferred by batch cap | '+result.deferredCapacity+' |',
  '',
  'GDELT Project source: https://www.gdeltproject.org/',
  '',
  'A source domain is not a verified publisher, event location or a reuse licence.',
  '',
 ].join('\n');
 appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
}
