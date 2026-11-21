/** Public identity only. Internal product IDs and stored contracts remain stable. */
export const BRAND_NAME='DLKT INFO' as const;
export const BRAND_DESCRIPTOR='Daily Life. Key Things.' as const;
export const KATE_IMAGE_PATH='/kate-head.png' as const;
/** Kate is decorative here; the containing wordmark supplies its accessible name. */
function wordmarkContents(name:typeof BRAND_NAME|'DLKT'):string {return `<img class="kate-mark" src="${KATE_IMAGE_PATH}" alt="" width="64" height="64"><span class="brand-name">${name}</span>`;}
export function brandContents():string {return wordmarkContents(BRAND_NAME);}
export function brandLink():string {return `<a href="/" class="brand" aria-label="DLKT INFO home">${brandContents()}</a>`;}
/** Both public placements use the same compact identity; legal/product names remain DLKT INFO. */
function identityLink(placement:'header'|'footer'):string {return `<a href="/" class="brand brand-${placement}" aria-label="DLKT INFO home"><span class="brand-lockup">${wordmarkContents('DLKT')}</span><span class="brand-tagline">${BRAND_DESCRIPTOR}</span></a>`;}
export function headerBrandLink():string {return identityLink('header');}
export function footerBrandLink():string {return identityLink('footer');}
