import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {hdbEvidenceRequest,hdbEvidenceContext,captureSigningBytes,buildHdbEvidenceGateway} from '../scripts/primary-data-evidence-gateway.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const documents=[read('../docs/iceo-global-coverage-baseline-20261127.md'),read('../docs/evidence/global-coverage-operational-244-20261127.txt')];
const ledger=read('../docs/evidence/source-qualification-research-20261127.json');
const packet=read('../docs/evidence/primary-data-hdb-catalogue-20261127.json');
const model='2005ad5cf04f6ea0f04080eeb66a99f6d895b55d',asOf='2026-11-27T19:30:00.000Z';
const context=hdbEvidenceContext(documents,model,ledger,packet,asOf);
const keys=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
const hash=value=>createHash('sha256').update(value).digest('hex');
const trust={evidenceClass:'synthetic-fixture',publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'})};
const signerKeySha256=hash(keys.publicKey.export({type:'spki',format:'der'}));
const dataset='d_b51323a474ba789fb4cc3db58a3116d4';
const fixtureRow=(town,price)=>({quarter:'2026-Q2',town,flat_type:'4-room',price});
const fixtureBody=(town,price)=>({success:true,result:{resource_id:dataset,records:[fixtureRow(town,price)],total:1,limit:2,offset:0}});
function capture(town,price,{raw,patch={}}={}){
 const body=Buffer.from(raw??JSON.stringify(fixtureBody(town,price)),'utf8');
 const url=hdbEvidenceRequest(town);
 const receipt={format:'dlkt-primary-data-capture-1',evidenceClass:'synthetic-fixture',contextSha256:context.contextSha256,
  signerKeySha256,requestUrl:url,responseUrl:url,method:'GET',status:200,contentType:'application/json',
  redirected:false,capturedAt:'2026-11-27T19:25:00.000Z',bodyEncoding:'decoded-http-entity-utf8',bodyBytes:body.length,bodySha256:hash(body),...patch};
 return {receipt,signature:sign(null,captureSigningBytes(receipt),keys.privateKey).toString('base64'),body};
}
// All prices in these fixtures are invented solely for unit testing.
const pair=()=>[capture('Ang Mo Kio','123000'),capture('Bedok','101000')];
const run=(captures=pair(),config=trust,clock=asOf,sourceLedger=ledger)=>buildHdbEvidenceGateway(documents,model,sourceLedger,packet,clock,captures,config);

test('two exact documented filter requests are bounded and non-executable authorization is explicit',()=>{
 assert.equal(context.requestUrls.length,2);assert.equal(context.probeAllowed,false);
 for(const [index,town] of ['Ang Mo Kio','Bedok'].entries()){
  const url=new URL(context.requestUrls[index]);assert.equal(url.origin,'https://data.gov.sg');
  assert.equal(url.pathname,'/api/action/datastore_search');
  assert.deepEqual([...url.searchParams.keys()],['resource_id','limit','offset','fields','filters']);
  assert.equal(url.searchParams.get('resource_id'),dataset);assert.equal(url.searchParams.get('limit'),'2');
  assert.equal(url.searchParams.get('offset'),'0');assert.equal(url.searchParams.get('fields'),'quarter,town,flat_type,price');
  assert.deepEqual(JSON.parse(url.searchParams.get('filters')),{quarter:'2026-Q2',town,flat_type:'4-room'});
 }
 assert.throws(()=>hdbEvidenceRequest('https://example.org/'),/DATA_EVIDENCE_TOWN/);
});

test('signed synthetic receipts verify exact bytes but never authenticate provider or authorize a claim',()=>{
 const input=pair(),r=run(input.reverse());assert.equal(r.status,'PRIMARY_DATA_EVIDENCE_RESEARCH_ONLY');
 assert.equal(r.evidenceClass,'synthetic-fixture');assert.equal(r.signatureState,'verified-against-caller-supplied-collector-key');
 assert.equal(r.remoteOriginAuthenticated,false);assert.equal(r.collectorAuthority,'not-independently-established');
 assert.equal(r.comparison.difference,22000);assert.equal(r.comparison.currency,null);
 assert.equal(r.statisticalPeriod,'2026-Q2');assert.equal(r.officialPeriod,'2026-Q3');assert.equal(r.availability.lagQuarters,1);
 assert.equal(r.latestPublication.state,'held');assert.equal(r.sameDatasetVersionEstablished,false);
 assert.equal(r.completeDataset,false);assert.equal(r.countsAsNationalNewsCoverage,false);
 assert.equal(r.probeAllowed,false);assert.equal(r.activationAllowed,false);assert.equal(r.publicationAllowed,false);
 assert.equal(r.receipts[0].bodySha256,input[1].receipt.bodySha256);
 assert.ok(r.receipts.every(row=>!Object.hasOwn(row,'body')&&/^[a-f0-9]{64}$/u.test(row.signedReceiptSha256)));
});

test('tampering, unknown keys and a self-declared real capture never authenticate',()=>{
 const input=pair();input[0].body[0]^=1;assert.throws(()=>run(input),/DATA_EVIDENCE_BODY_INTEGRITY/);
 const changed=pair();changed[0].receipt.capturedAt='2026-11-27T19:24:00.000Z';
 assert.throws(()=>run(changed),/DATA_EVIDENCE_SIGNATURE_INVALID/);
 assert.throws(()=>run(pair(),{...trust,publicKeyPem:other.publicKey.export({type:'spki',format:'pem'})}),/DATA_EVIDENCE_RECEIPT_BINDING/);
 assert.throws(()=>run(pair(),{...trust,evidenceClass:'external-research-capture'}),/DATA_EVIDENCE_RECEIPT_BINDING/);
 assert.throws(()=>run(pair(),null),/DATA_EVIDENCE_COLLECTOR_KEY_REQUIRED/);
 assert.throws(()=>run(pair(),{...trust,publicKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'})}),/DATA_EVIDENCE_COLLECTOR_KEY_REQUIRED/);
 const embedded=pair();embedded[0].receipt.publicKeyPem=trust.publicKeyPem;assert.throws(()=>run(embedded),/DATA_EVIDENCE_RECEIPT_SHAPE/);
});

test('redirects, incorrect request identity, failed HTTP and receipt replay fail closed even when signed',()=>{
 const good=capture('Bedok','101000');
 for(const patch of [{redirected:true},{responseUrl:'https://example.org/'},{method:'POST'},{contextSha256:'0'.repeat(64)}]){
  assert.throws(()=>run([capture('Ang Mo Kio','123000',{patch}),good]),/DATA_EVIDENCE_(REQUEST_BINDING|RECEIPT_BINDING)/);
 }
 for(const patch of [{status:403},{status:429},{status:302},{contentType:'text/html'},{bodyEncoding:'wire-bytes'}]){
  assert.throws(()=>run([capture('Ang Mo Kio','123000',{patch}),good]),/DATA_EVIDENCE_TRANSPORT/);
 }
 assert.throws(()=>run([good,good]),/DATA_EVIDENCE_CAPTURE_SET/);
 assert.throws(()=>run([good]),/DATA_EVIDENCE_CAPTURE_COUNT/);
});

test('provisional response adapter rejects schema drift, extra personal fields, duplicate keys and out-of-filter cells',()=>{
 const good=capture('Bedok','101000');
 const withBody=value=>run([capture('Ang Mo Kio','123000',{raw:JSON.stringify(value)}),good]);
 const invalid=[
  [{success:false,result:{}},/RESPONSE_ENVELOPE/],
  [{success:true,result:{resource_id:'other',records:[],total:0}},/RESPONSE_DATASET/],
  [{success:true,result:{resource_id:dataset,records:[fixtureRow('Ang Mo Kio','1'),fixtureRow('Ang Mo Kio','2')],total:2}},/RESPONSE_CARDINALITY/],
  [{success:true,result:{resource_id:dataset,records:[fixtureRow('Ang Mo Kio','1')],total:1,total_was_estimated:true}},/RESPONSE_CARDINALITY/],
  [{success:true,result:{resource_id:dataset,records:[fixtureRow('Bedok','1')],total:1}},/ROW_FILTER/],
  [{success:true,result:{resource_id:dataset,records:[{...fixtureRow('Ang Mo Kio','1'),quarter:'2026-Q3'}],total:1}},/ROW_FILTER/],
  [{success:true,result:{resource_id:dataset,records:[{...fixtureRow('Ang Mo Kio','1'),address:'unexpected'}],total:1}},/ROW_FIELDS/],
 ];
 for(const [body,error] of invalid)assert.throws(()=>withBody(body),error);
 const duplicate=JSON.stringify(fixtureBody('Ang Mo Kio','1')).replace('"price":"1"','"price":"1","\\u0070rice":"2"');
 assert.throws(()=>run([capture('Ang Mo Kio','1',{raw:duplicate}),good]),/DATA_EVIDENCE_DUPLICATE_JSON_KEY/);
 assert.throws(()=>run([capture('Ang Mo Kio','1',{raw:'{"success":'}),good]),/DATA_EVIDENCE_BODY_JSON/);
 assert.throws(()=>run([capture('Ang Mo Kio','1',{raw:' '.repeat(128*1024+1)}),good]),/DATA_EVIDENCE_BODY_INTEGRITY/);
 assert.throws(()=>run([capture('Ang Mo Kio','0'),good]),/PRIMARY_DATA_PRICE_VALUE/);
});

test('zero rows and producer absence markers remain unavailable rather than becoming zero prices',()=>{
 const noRows={success:true,result:{resource_id:dataset,records:[],total:0}};
 const r=run([capture('Ang Mo Kio','1',{raw:JSON.stringify(noRows)}),capture('Bedok','101000')]);
 assert.equal(r.receipts[0].rowCount,0);assert.equal(r.comparison.difference,null);
 for(const value of ['*','-','na',null])assert.equal(run([capture('Ang Mo Kio',value),capture('Bedok','101000')]).comparison.difference,null);
});

test('capture time cannot replace the statistical period, and stale or restricted research remains held',()=>{
 const good=capture('Bedok','101000');
 for(const date of ['2026-11-28T00:00:00.000Z','2026-11-26T19:25:00.000Z','2026-11-27T19:25:00Z'])
  assert.throws(()=>run([capture('Ang Mo Kio','123000',{patch:{capturedAt:date}}),good]),/DATA_EVIDENCE_CAPTURE_TIME/);
 assert.throws(()=>run([capture('Ang Mo Kio','123000',{patch:{capturedAt:'2026-11-27T19:00:00.000Z'}}),good]),/DATA_EVIDENCE_CAPTURE_WINDOW/);
 assert.throws(()=>run(pair(),trust,'2026-11-29T19:30:00.000Z'),/DATA_EVIDENCE_CAPTURE_TIME/);
 assert.throws(()=>run(pair(),trust,'2026-12-28T19:30:00.000Z'),/DATA_EVIDENCE_SOURCE_RESEARCH_HELD/);
 const restricted=JSON.parse(ledger);restricted.entries.find(row=>row.id==='hdb-sg-median-resale').evidence.push({
  url:'https://data.gov.sg/datasets/'+dataset+'/view',signal:'commercial-restriction',scope:'Controlled restrictive fixture'});
 assert.throws(()=>run(pair(),trust,asOf,JSON.stringify(restricted)),/DATA_EVIDENCE_SOURCE_RESEARCH_HELD/);
});
