/** Capability descriptions are eligibility notes, never evidence of a live connection.
 * Primary references, checked 2026-11-20:
 * https://developers.google.com/workspace/gmail/api/auth/scopes
 * https://learn.microsoft.com/en-us/graph/api/mailfolder-list-messages
 * https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
 * https://developers.facebook.com/docs/graph-api/reference/page/conversations/
 */
export const WALLET_PROVIDER_IDS = Object.freeze(['gmail', 'outlook', 'instagram', 'facebook-pages']);
function provider(id, name, accountType, capabilities, limitations) {
    return Object.freeze({ id, name, accountType, status: 'unavailable', capabilities: Object.freeze([...capabilities]), limitations: Object.freeze([...limitations]), connectionAvailable: false });
}
const PROVIDERS = Object.freeze([
    provider('gmail', 'Gmail', 'Personal Google or Google Workspace account', [
        'Sender, subject, received time and unread status, with your permission.',
        'Group messages by conversation and open them in Gmail.',
    ], [
        'Availability depends on the DLKT OAuth application and the access approved for your account. Public Gmail access requires Google verification.',
        'Reads message metadata only. It does not read message bodies or send email.',
    ]),
    provider('outlook', 'Outlook', 'Personal Microsoft or work / school account', [
        'Basic message details, with your permission.',
        'Reading message contents requires separate, broader permission.',
    ], [
        'Your organization may require administrator approval.',
        'DLKT does not send messages or change your inbox.',
    ]),
    provider('instagram', 'Instagram', 'Instagram Business or Creator account', [
        'Recent comments on your professional posts, with the permissions you grant.',
        'Eligible professional accounts can authorize access through Instagram Login.',
    ], [
        'Ordinary personal Instagram accounts are not eligible for this integration.',
        'The current connection does not retrieve direct messages, mentions, insights or identities of viewers and sharers.',
    ]),
    provider('facebook-pages', 'Facebook Pages', 'A Facebook Page you manage', [
        'Recent comments on posts from Facebook Pages you manage.',
        'A bounded check of the Pages and posts actually supplied by Facebook.',
    ], [
        'This integration does not provide your personal Facebook inbox.',
        'The current connection does not retrieve conversations, insights or identities of viewers and sharers.',
    ]),
]);
/** Static catalogue. Only the authenticated connections API reports live availability. */
export function getWalletProviders() { return PROVIDERS; }
export function isWalletProviderId(value) {
    return typeof value === 'string' && WALLET_PROVIDER_IDS.includes(value);
}
