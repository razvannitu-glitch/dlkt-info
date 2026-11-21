/** Automatic context never navigates. Only an explicit choice changes the visible edition. */
export type EntryView = 'start' | 'topics' | 'local' | 'daily';
export interface EntryState { readonly view: EntryView; readonly deliberate: boolean; readonly localRestored: boolean; readonly dailyRestored?:boolean }
export type EntryAction = {readonly type:'suggest';readonly view:'local'} | { readonly type: 'choose'; readonly view: EntryView } | { readonly type: 'interact' } | { readonly type: 'restore'; readonly view: 'topics' | 'local' | 'daily' };
export const initialEntryState: EntryState = { view: 'start', deliberate: false, localRestored: false };
export function reduceEntry(state: EntryState, action: EntryAction): EntryState {
  if (action.type === 'suggest') return state;
  if (action.type === 'interact') return { ...state, deliberate: true };
  if (action.type === 'choose') return { ...state, deliberate: true, view: action.view };
  if (state.deliberate) return state;
  return { ...state, localRestored: state.localRestored || action.view === 'local', ...(action.view==='daily'?{dailyRestored:true}:{}) };
}

/** An empty search returns to the current local edition; a query is explicit exploration. */
export function topicSearchView(query: string): 'start' | 'topics' {
  return query.trim() ? 'topics' : 'start';
}
