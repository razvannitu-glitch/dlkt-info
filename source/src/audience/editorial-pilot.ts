import type {NewsCategoryId} from '../iceo/news-taxonomy.js';

// Proposed laboratory subset, NOT an approved production privacy allowlist.
export const EDITORIAL_PILOT_CATEGORIES=Object.freeze([
 '05000000','06000000','13000000','15000000','17000000',
] as const satisfies readonly NewsCategoryId[]);
export type EditorialPilotCategory=typeof EDITORIAL_PILOT_CATEGORIES[number];
const categoryIds:ReadonlySet<string>=new Set(EDITORIAL_PILOT_CATEGORIES);
export function isEditorialPilotCategory(value:unknown):value is EditorialPilotCategory{
 return typeof value==='string'&&categoryIds.has(value);
}
