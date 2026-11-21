export const CONNECTIONS_VERSION = 'dlkt-info-connections-1';
/** Microsoft personal accounts require a registered redirect URI without query parameters. */
export function connectionCallbackPath(providerId) {
    return providerId === 'outlook' ? '/api/connections' : `/api/connections?provider=${providerId}`;
}
