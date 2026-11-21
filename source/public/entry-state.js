export const initialEntryState = { view: 'start', deliberate: false, localRestored: false };
export function reduceEntry(state, action) {
    if (action.type === 'suggest')
        return state;
    if (action.type === 'interact')
        return { ...state, deliberate: true };
    if (action.type === 'choose')
        return { ...state, deliberate: true, view: action.view };
    if (state.deliberate)
        return state;
    return { ...state, localRestored: state.localRestored || action.view === 'local', ...(action.view === 'daily' ? { dailyRestored: true } : {}) };
}
/** An empty search returns to the current local edition; a query is explicit exploration. */
export function topicSearchView(query) {
    return query.trim() ? 'topics' : 'start';
}
