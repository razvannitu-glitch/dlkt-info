import type {SourceDefinition} from './contracts.js';

const rights = {rightsCheckedAt:'2026-11-15',rightsReviewBy:'2026-12-15'} as const;
/** Feed discovery, terms and robots were reviewed separately; no arbitrary visitor URLs. */
export const REVIEWED_FEEDS: readonly SourceDefinition[] = Object.freeze([
  {
    ...rights,id:'nasa-news',label:'NASA science and missions',publisher:'NASA',topic:'science',adapter:'reviewed-feed',
    endpoint:'https://www.nasa.gov/news-release/feed/',homepage:'https://www.nasa.gov/rss-feeds/',
    termsUrl:'https://www.nasa.gov/nasa-brand-center/',
    attribution:'Source: NASA. Publisher feed text; any displayed image has its own credit and usage terms. No NASA endorsement is implied. Read the original for the full context.',
    scope:'Recent entries from the NASA feed, including mission, science and image-article listings. Last 30 days of the available feed; not comprehensive science coverage.',
    feed:{format:'rss',title:'NASA',homeOrigin:'https://www.nasa.gov',articleOrigins:['https://www.nasa.gov','https://science.nasa.gov'],articlePaths:['/'],dateField:'pubDate',dateLabel:'Published',summary:'description',refreshSeconds:1800,windowDays:30,
      boundary:'NASA publisher excerpt, which may already be shortened in the feed. This is not independent corroboration, a full-article summary or a live mission status check.'},
  },
  {
    ...rights,id:'usgs-news',label:'USGS Earth science',publisher:'U.S. Geological Survey',topic:'environment',adapter:'reviewed-feed',
    endpoint:'https://www.usgs.gov/news/149248/feed',homepage:'https://www.usgs.gov/news/news-releases/national-news-releases',
    termsUrl:'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
    attribution:'Credit: U.S. Geological Survey. Publisher feed text only; third-party media are not republished.',
    scope:'USGS national Earth science release listings from the available feed, last 30 days. Not local environmental monitoring or an emergency warning service.',
    feed:{format:'rss',title:'National News Release',homeOrigin:'https://www.usgs.gov',articleOrigins:['https://www.usgs.gov'],articlePaths:['/news/national-news-release/'],trackingQueryKeys:['utm_source','utm_medium','utm_campaign'],dateField:'pubDate',dateLabel:'Published',summary:'description',refreshSeconds:1800,windowDays:30,
      boundary:'USGS publisher excerpt. Statements and estimates remain attributed to USGS; no local hazard, emergency status or independent confirmation is inferred.'},
  },
  {
    ...rights,id:'fda-news',label:'US FDA announcements',publisher:'U.S. Food and Drug Administration',topic:'health',adapter:'reviewed-feed',
    endpoint:'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml',homepage:'https://www.fda.gov/about-fda/contact-fda/subscribe-podcasts-and-news-feeds',
    termsUrl:'https://www.fda.gov/about-fda/about-website/website-policies',
    attribution:'Source: U.S. Food and Drug Administration. Original FDA feed text and links; no medical advice or implied FDA endorsement.',
    scope:'US FDA press announcements in the available feed, last 30 days. US regulatory decisions do not establish authorisation, availability or treatment suitability in another country.',
    feed:{format:'rss',title:'FDA Press Releases RSS Feed',homeOrigin:'https://www.fda.gov',articleOrigins:['https://www.fda.gov'],articlePaths:['/news-events/press-announcements/'],allowHttpLinks:true,dateField:'pubDate',dateLabel:'Published',summary:'description',refreshSeconds:3600,windowDays:30,
      boundary:'US FDA publisher excerpt. This is US regulatory information, not personal medical advice; it does not establish approval or availability in your country.'},
  },
  {
    ...rights,id:'govuk-news',label:'UK public announcements',publisher:'UK Government',topic:'public-affairs',adapter:'reviewed-feed',
    endpoint:'https://www.gov.uk/search/news-and-communications.atom',homepage:'https://www.gov.uk/search/news-and-communications',
    termsUrl:'https://www.gov.uk/help/terms-conditions',
    attribution:'Contains public sector information licensed under the Open Government Licence v3.0. Source: GOV.UK. No UK Government endorsement is implied.',
    scope:'Recent UK government communications in the available Atom feed, last 30 days. These are publisher statements, not independent worldwide news reporting. Feed dates indicate updates.',
    feed:{format:'atom',title:'News and communications',homeOrigin:'https://www.gov.uk',articleOrigins:['https://www.gov.uk'],articlePaths:['/government/'],dateField:'updated',dateLabel:'Updated',summary:'summary',refreshSeconds:1800,windowDays:30,
      boundary:'UK Government publisher excerpt. Updated is the feed update date, not proof of first publication. Claims remain attributed to the publisher and are not independently corroborated.'},
  },
]);
