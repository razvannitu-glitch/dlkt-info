import {hasEditorialTopics} from './editorial-topics.js';
import type {EvidenceCard,Topic} from './contracts.js';

type TopicSource=Readonly<{id:string;topic:Topic}>;

/** Reclassification is allowed only for the explicitly reviewed multi-subject sources. */
export function sourceMatchesCardTopic(source:TopicSource,card:Pick<EvidenceCard,'topic'|'sourceIds'>):boolean {
 return card.sourceIds.includes(source.id)&&(source.topic===card.topic||hasEditorialTopics(source.id));
}

/** A broad feed is relevant only through its primary topic or an actual selected record. */
export function sourceRelevantToTopics(source:TopicSource,topics:readonly Topic[],records:readonly EvidenceCard[]):boolean {
 return topics.includes(source.topic)||records.some(card=>topics.includes(card.topic)&&sourceMatchesCardTopic(source,card));
}

/** Coverage is supported by a primary-topic source or a source-linked editorial record. */
export function sourcesCoverTopic(sources:readonly TopicSource[],topic:Topic,records:readonly EvidenceCard[]):boolean {
 return sources.some(source=>sourceRelevantToTopics(source,[topic],records));
}
