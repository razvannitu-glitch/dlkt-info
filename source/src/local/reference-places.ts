import type {LocalPlace,CityPlaces} from './places.js';
import type {City} from './contracts.js';
/** CC0 structured-data reference points, reviewed 17 November 2026. Not live venue checks. */
export const BUCHAREST_REFERENCES:readonly LocalPlace[]=[
 {
  "id": "Q17169956",
  "name": "Caru' cu Bere",
  "category": "food",
  "type": "Place reference",
  "lat": 44.4321,
  "lon": 26.0981,
  "address": null,
  "sourceUrl": "https://www.wikidata.org/wiki/Q17169956",
  "source": "wikidata"
 },
 {
  "id": "Q1159652",
  "name": "Manuc's Inn",
  "category": "food",
  "type": "Place reference",
  "lat": 44.429555555556,
  "lon": 26.10205,
  "address": null,
  "sourceUrl": "https://www.wikidata.org/wiki/Q1159652",
  "source": "wikidata"
 },
 {
  "id": "Q1319192",
  "name": "National Museum of Art of Romania",
  "category": "culture",
  "type": "Place reference",
  "lat": 44.43978,
  "lon": 26.09598,
  "address": null,
  "sourceUrl": "https://www.wikidata.org/wiki/Q1319192",
  "source": "wikidata"
 },
 {
  "id": "Q3330898",
  "name": "“Grigore Antipa” National Museum of Natural History",
  "category": "culture",
  "type": "Place reference",
  "lat": 44.4531,
  "lon": 26.0846,
  "address": null,
  "sourceUrl": "https://www.wikidata.org/wiki/Q3330898",
  "source": "wikidata"
 },
 {
  "id": "Q2074133",
  "name": "Herăstrău Park",
  "category": "outdoors",
  "type": "Place reference",
  "lat": 44.47921,
  "lon": 26.08169,
  "address": null,
  "sourceUrl": "https://www.wikidata.org/wiki/Q2074133",
  "source": "wikidata"
 },
 {
  "id": "Q959632",
  "name": "Cișmigiu Gardens",
  "category": "outdoors",
  "type": "Place reference",
  "lat": 44.437,
  "lon": 26.09073,
  "address": null,
  "sourceUrl": "https://www.wikidata.org/wiki/Q959632",
  "source": "wikidata"
 }
];
export function referencePlaces(city:City):CityPlaces|null{return city.id==='683506'?{state:'reference',checkedAt:null,validTo:null,dataAsOf:'2026-11-17T00:00:00.000Z',items:BUCHAREST_REFERENCES}:null;}
