import type {EvidenceCard} from '../iceo/contracts.js';
import type {ReaderSettings} from '../iceo/reader.js';
export const EDITION_VERSION='dlkt-info-edition-1' as const;
export interface EditionStoryGroup {
 readonly key:string;
 readonly primaryId:string;
 readonly basis:'matching-headlines'|'shared-event'|'software-versions';
 readonly related:readonly EvidenceCard[];
}
export interface Edition {
 readonly version:typeof EDITION_VERSION;readonly id:string;readonly generatedAt:string;readonly sourceCheckAt:string;
 readonly state:'ready'|'partial'|'empty'|'unavailable';readonly kind:'current-source-selection';
 readonly settings:ReaderSettings;readonly cards:readonly EvidenceCard[];
 /** Optional for old archives; complete secondary originals stay under one primary. */
 readonly storyGroups?:readonly EditionStoryGroup[];
 readonly sourceChecks:readonly {id:string;state:string;verifiedAt:string|null}[];
 readonly availableGroups:number;readonly excludedNotices:number;readonly excludedStale:number;
 readonly delivered:false;readonly persisted:false;
}
