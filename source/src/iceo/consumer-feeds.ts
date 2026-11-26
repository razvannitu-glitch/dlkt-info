import type {SourceDefinition} from './contracts.js';
const rights={rightsCheckedAt:'2026-11-17',rightsReviewBy:'2026-12-17'} as const;
export const CONSUMER_FEEDS:readonly SourceDefinition[]=Object.freeze([
  {...rights,id:'cfpb-newsroom',label:'US consumer financial protection news',publisher:'Consumer Financial Protection Bureau',topic:'money',adapter:'reviewed-feed',
    endpoint:'https://www.consumerfinance.gov/about-us/newsroom/feed/',homepage:'https://www.consumerfinance.gov/about-us/newsroom/',
    termsUrl:'https://www.consumerfinance.gov/privacy/website-privacy-policy/',
    attribution:'Source: Consumer Financial Protection Bureau (CFPB). CFPB-created website text is in the US public domain; third-party material, images and logos are excluded. No CFPB endorsement is implied.',
    scope:'Recent original CFPB newsroom releases from the United States, last 30 days of the available RSS feed. These are agency statements, not universal consumer rights, a live loan-rate service or personalised financial advice.',
    rightsCheckedAt:'2026-11-26',rightsReviewBy:'2026-12-26',
    feed:{format:'rss',title:'Newsroom | Consumer Financial Protection Bureau',homeOrigin:'https://www.consumerfinance.gov',homePath:'/about-us/newsroom/',
      articleOrigins:['https://www.consumerfinance.gov'],articlePaths:['/about-us/newsroom/'],
      dateField:'pubDate',dateLabel:'Published',summary:'description',refreshSeconds:3600,windowDays:30,
      boundary:'Original US consumer financial agency announcement. Dates refer to CFPB release publication, not the effective date of a rule. Check applicability and original text; no independent corroboration, individual advice or non-US legal effect is inferred.'}},
 {...rights,id:'govuk-products',label:'UK product safety alerts and recalls',publisher:'UK Government',topic:'public-affairs',adapter:'reviewed-feed',endpoint:'https://www.gov.uk/product-safety-alerts-reports-recalls.atom',homepage:'https://www.gov.uk/product-safety-alerts-reports-recalls',termsUrl:'https://www.gov.uk/help/terms-conditions',
  attribution:'Contains public sector information licensed under the Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Source: GOV.UK / Office for Product Safety and Standards. No third-party photos, logos or endorsement.',
  scope:'UK Office for Product Safety and Standards product alert, report and recall listings, last 30 days of the available feed. Not worldwide recall coverage, food, vehicles or medicines. Feed update dates are not recall dates.',
  feed:{format:'atom',title:'Product Safety Alerts, Reports and Recalls',homeOrigin:'https://www.gov.uk',articleOrigins:['https://www.gov.uk'],articlePaths:['/product-safety-alerts-reports-recalls/'],dateField:'updated',dateLabel:'Updated',summary:'summary',refreshSeconds:1800,windowDays:30,
   boundary:'UK product-safety publisher listing. Updated is the feed update date; the original recall or alert may be older. Check the exact model, batch, affected country and original instructions. No personal exposure or current recall status is inferred.'}},
 {...rights,id:'ncsc-news',label:'NCSC cyber security news',publisher:'UK National Cyber Security Centre',topic:'digital-life',adapter:'reviewed-feed',endpoint:'https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml',homepage:'https://www.ncsc.gov.uk/information/rss-feeds',termsUrl:'https://www.ncsc.gov.uk/section/about-this-website/terms-and-conditions',
  attribution:'Contains public sector information licensed under the Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Source: National Cyber Security Centre. Original feed text only; no third-party media, logos or endorsement.',
  scope:'UK NCSC news in its available feed, last 30 days. Includes organisational cyber-security news; not every consumer scam, a real-time attack feed or an assessment of your devices.',
  feed:{format:'rss',title:'News Feed',homeOrigin:'https://www.ncsc.gov.uk',articleOrigins:['https://www.ncsc.gov.uk'],articlePaths:['/news/'],dateField:'pubDate',dateLabel:'Published',summary:'description',refreshSeconds:3600,windowDays:30,
   boundary:'NCSC publisher news or excerpt. Guidance and warnings retain their stated audience and jurisdiction. No personal breach, device vulnerability, emergency status or independent corroboration is inferred.'}},
]);
