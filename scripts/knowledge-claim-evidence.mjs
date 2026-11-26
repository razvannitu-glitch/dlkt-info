import {createHash} from 'node:crypto';

// Digests of complete passages from the two official pages and their exact
// copyright notices. Their meanings were mapped during the 2026-11-26
// source reading; these are candidate specifications, not independent reviews.
// No copied publisher prose, mutable model output or production approvals.
const specs={
  "dlkt-elsewhere-nsw-fuelcheck": {
    "digest": "772d754d42ceb10260b4c02c1b4c97fcb1949ddbf61d6b0cd17fb2b88fa1c88b",
    "source": {
      "free-government-service": "f4046ba7d7b681b90324bc26af380146791659d1e5bcfd89e3bfc08ab02bca63",
      "current-price-information": "adbc3d0c7e2baf8ea13d3c43f6eea3d087d2c8e9ea07bbeb12d8b66aba0570c7",
      "nearby-fuel-comparison": "2d2945108ccb901a5102ae52b035f0bf5021797b639d386b1138964b26b0852f",
      "fuel-type-comparison": "fb0b7a7e4d2e8a8e8f89c3293b8edeefaf8ac71a8a18240a1b6e0e4da68fbabd",
      "driving-safety": "cc819877503dd6ae4403a02c89bc325afe9c1248024339ce26830aeeadcd031e"
    },
    "terms": {
      "general-licence-and-exception": "45c597f81e35cc31c19e9e19307804d726864a9cda304faf7da7dd7a56961d72",
      "third-party-exclusion": "ccb47e67924d4f0474af81b952b68be3c30e763e6e1d588b68d655af680a61d3",
      "special-conditions-exclusion": "29dcaa7f103798bb7b474d2b8a7827cd5b4bb382769d8305824a1dc20114876d"
    },
    "claims": [
      {
        "id": "free-official-service",
        "kind": "primary-source-fact",
        "meaning": "FuelCheck is provided free of charge by the NSW Government.",
        "anchors": [
          "free-government-service"
        ]
      },
      {
        "id": "current-comparable-prices",
        "kind": "primary-source-fact",
        "meaning": "The service supplies current fuel prices and helps compare nearby options by fuel type.",
        "anchors": [
          "current-price-information",
          "nearby-fuel-comparison",
          "fuel-type-comparison"
        ]
      },
      {
        "id": "safe-use",
        "kind": "primary-source-fact",
        "meaning": "Do not use a phone while driving.",
        "anchors": [
          "driving-safety"
        ]
      },
      {
        "id": "conditional-local-use",
        "kind": "editorial-guidance",
        "meaning": "Look for a trustworthy comparable service locally and consider travel distance; no assertion of availability outside NSW or guaranteed savings.",
        "anchors": [
          "fuel-type-comparison"
        ]
      }
    ],
    "fields": {
      "topic": [
        "current-comparable-prices"
      ],
      "title": [
        "free-official-service",
        "current-comparable-prices"
      ],
      "explanation": [
        "free-official-service",
        "current-comparable-prices"
      ],
      "connection": [
        "conditional-local-use",
        "safe-use"
      ]
    },
    "limits": [
      "NSW scope only; no assertion that FuelCheck is available in the reader's country.",
      "No guaranteed savings, current individual station price, stock or cheapest route.",
      "Text-only original synthesis; preserve source credit and safety condition."
    ]
  },
  "dlkt-elsewhere-nz-unit-pricing": {
    "digest": "e42b9287c79f455ec5ee9c2b8654f76038b849c3ba40eda4a2eb4612880d5999",
    "source": {
      "unit-price-comparison": "761d00484f386117a8e0f2d6a4f17ec5f82eb767ab78766a5139d800662c756c",
      "qualified-retailers": "c724a490e92fad877ddc5aca038a76050bd99cc57c14d778e2df825ed558781c"
    },
    "terms": {
      "general-licence-and-exception": "7f16a40e0f84ea5166007c1ae5c66d69c77d8cf67a10b8dd0aa18533c6189394",
      "attribution-condition": "d8cb230bdb724d377b3e904ef7f1d1474b5cbab344fa3ea3bb757627e573adc5",
      "third-party-exclusion": "c4cf092ec8dbfd28f48694ef8f2a4b62070c47573e6a7c7fb1a325146c670f66"
    },
    "claims": [
      {
        "id": "qualified-nz-obligation",
        "kind": "primary-source-fact",
        "meaning": "NZ unit-pricing requirements apply to qualifying grocery retailers, not every shop; card makes no claim that every product is covered.",
        "anchors": [
          "qualified-retailers"
        ]
      },
      {
        "id": "comparable-unit-prices",
        "kind": "primary-source-fact",
        "meaning": "Unit prices help customers compare equivalent quantities.",
        "anchors": [
          "unit-price-comparison"
        ]
      },
      {
        "id": "pack-size-not-value",
        "kind": "editorial-inference",
        "meaning": "A larger package does not necessarily have a lower price per unit; no claim that bigger is always more expensive.",
        "anchors": [
          "unit-price-comparison"
        ]
      },
      {
        "id": "usable-quantity",
        "kind": "editorial-guidance",
        "meaning": "Compare equivalent units, such as kilograms or litres where relevant, and consider actual consumption.",
        "anchors": [
          "unit-price-comparison"
        ]
      }
    ],
    "fields": {
      "topic": [
        "comparable-unit-prices"
      ],
      "title": [
        "pack-size-not-value"
      ],
      "explanation": [
        "qualified-nz-obligation",
        "comparable-unit-prices"
      ],
      "connection": [
        "usable-quantity"
      ]
    },
    "limits": [
      "New Zealand rules only; retain qualifying-retailer and covered-goods boundaries.",
      "No numerical savings guarantee or universal legal claim.",
      "No copied imagery, logos, site design or third-party material."
    ]
  }
};
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const normalizeBlock=value=>value.replace(/[\u200B-\u200D\uFEFF]/gu,'').replace(/\s+/gu,' ').replace(/\s+([,.;:!?])/gu,'$1').trim();
const hidden=node=>['script','style','template','noscript','svg','nav','footer','aside'].includes(node.name)||
 node.attribs?.['aria-hidden']==='true'||Object.hasOwn(node.attribs??{},'hidden')||
 /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/iu.test(node.attribs?.style??'');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export function knowledgeClaimAnchors(id,role){
 const spec=typeof id==='string'&&Object.hasOwn(specs,id)?specs[id]:null;
 if(!spec||!['source','terms'].includes(role))return null;
 return Object.freeze({...spec[role]});
}
/** Match complete visible-text blocks, not individual keywords/substrings.
 * HTML-only evidence cannot establish CSS-computed visibility or truth.
 * A changed, negated, missing, duplicated or unbounded block is not a match.
 * No raw publisher text leaves this function.
 */
export function observeClaimAnchors(main,expected,visibleText){
 if(!record(expected)||Object.keys(expected).length>20||Object.values(expected).some(x=>!hex(x)))throw Error('KNOWLEDGE_CLAIM_ANCHORS_INVALID');
 const counts=new Map(Object.values(expected).map(digest=>[digest,0])),pending=[main];
 let nodes=0;
 while(pending.length){
  const node=pending.pop();if(++nodes>50000)throw Error('KNOWLEDGE_CLAIM_DOM_LIMIT');
  if(hidden(node))continue;
  if(['p','li'].includes(node.name)){
   // Nested paragraphs/lists cannot count the same passage twice.
   const nested=node.children?.some(child=>['p','li','ul','ol','div'].includes(child.name));
   if(!nested){
    const text=normalizeBlock(visibleText(node));
    if(text&&text.length<=4000){
     const digest=hash(text);if(counts.has(digest))counts.set(digest,counts.get(digest)+1);
    }
    continue;
   }
  }
  if(node.children)for(let i=node.children.length-1;i>=0;i--)pending.push(node.children[i]);
 }
 return Object.freeze(Object.fromEntries(Object.entries(expected).map(([id,digest])=>[id,Object.freeze({digest,matches:counts.get(digest)??0})])));
}
function exactMatches(actual,expected){
 if(!record(actual)||JSON.stringify(Object.keys(actual).sort())!==JSON.stringify(Object.keys(expected).sort()))return false;
 return Object.entries(expected).every(([key,digest])=>record(actual[key])&&actual[key].digest===digest&&actual[key].matches===1);
}
/** Candidate-specific evidence coverage only. Exact card digest binds every
 * existing EN/RO/IT topic/title/explanation/connection plus provenance/dates.
 * This is not a general language entailment or legal permission detector.
 */
export function assessKnowledgeClaimEvidence(identity,observation){
 const held=reason=>Object.freeze({state:'held',reason,activationAllowed:false,independentReviewRequired:true,claimChecks:[],fields:[]});
 const spec=record(identity)&&typeof identity.id==='string'&&Object.hasOwn(specs,identity.id)?specs[identity.id]:null;
 if(!spec||identity.digest!==spec.digest||typeof identity.payload!=='string'||identity.payload.length>20000||hash(identity.payload)!==spec.digest)return held('exact-candidate-text-changed-or-unmapped');
 if(!record(observation)||observation.id!==identity.id||observation.revision!==identity.revision||observation.candidateDigest!==spec.digest||
  observation.sourceUrl!==identity.sourceUrl||observation.policyUrl!==identity.policyUrl||observation.activationAllowed!==false||observation.state!=='observed-for-review'||
  observation.source?.state!=='observed-for-review'||observation.terms?.state!=='observed-for-review'||
  observation.source?.canonicalObserved!==true||observation.terms?.canonicalObserved!==true)return held('observation-unavailable-or-unbound');
 const source=observation.source.claimAnchors,terms=observation.terms.claimAnchors;
 const claimChecks=spec.claims.map(claim=>Object.freeze({...claim,anchors:Object.freeze([...claim.anchors]),state:claim.anchors.every(key=>source?.[key]?.digest===spec.source[key]&&source[key].matches===1)?'supporting-passages-matched':'review-required'}));
 const fields=['en','ro','it'].flatMap(language=>Object.entries(spec.fields).map(([field,claims])=>Object.freeze({language,field,claims:Object.freeze([...claims])})));
 const missingSource=!exactMatches(source,spec.source),missingTerms=!exactMatches(terms,spec.terms);
 return Object.freeze({state:missingSource||missingTerms?'held':'evidence-ready-for-independent-review',
  reason:missingSource?'source-passages-changed-missing-or-ambiguous':missingTerms?'policy-passages-changed-missing-or-ambiguous':null,
  activationAllowed:false,independentReviewRequired:true,translationReviewRequired:true,rightsReviewRequired:true,
  claimChecks:Object.freeze(claimChecks),fields:Object.freeze(fields),limits:Object.freeze([...spec.limits]),
  boundary:'Exact mapped laboratory text and complete supporting passages; guidance/inference separate from primary facts. No general semantic or translation proof.'});
}
