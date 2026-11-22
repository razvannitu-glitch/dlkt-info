# Article photograph contract

Task: DLKT-ARTICLE-PHOTOS-20261122. Canonical public platform: https://www.dlkt.ee/.

## Source and behavior

The user's requirement is the original photograph selected for each article, with no unrelated category illustration or portrait fallback. A real original image may itself be shared by publishers or repeated across reports; this implementation never changes a correct original simply to make an image unique.

`/api/article-photo?id=...&v=...` resolves a publication in the current ICEO snapshot. Local news adds `city` and resolves the exact local news ID and RSS document revision. The route never accepts a source URL, image URL, user location coordinates or arbitrary remote host. Unknown or expired records, non-publication cards and mismatched revisions cannot initiate article acquisition.

The server reads the publisher's canonical article metadata. Canonical and OG identities must agree with the resolved article. Article JSON-LD must explicitly identify that page and match the original headline; an ImageObject is usable only through the matching article's image field. Unrelated site images, recommendations and brand placeholders are excluded. For Guardian's signed variants of one image, a publisher-provided variant without a social overlay is preferred; signatures and query parameters are preserved verbatim.

The response is a bounded JPEG, PNG or WebP on the DLKT origin. HTTP type, raster signature and dimensions must agree. Article HTML is bounded to1MiB, image bytes to1.5MiB, decoded dimensions to24megapixels. Requests use no cookies or credentials, explicit origins/paths, manual redirect validation, robots checks, a12second deadline, eight pending photo jobs at most and a24MiB bounded image cache. Failures are cached briefly; successful image checks do not change the evidence card's text, content hash, publication date or source-check timestamp.

## Attribution and limits

The public card links directly to the original article and labels the image as its source photograph. A preview declared in OG/JSON-LD is evidence of association, not a new licence or proof that the image depicts today's event. No CC badge or photographer name is fabricated. Existing reviewed licensed photos retain their reviewed credit. Article body copying and the existing branded social-share PNG endpoint are outside this change.

A source can refuse access, omit media, change its metadata or publish an unsupported image host/type. In those cases the card remains usable with its title and actions and no substitute image. Coverage is limited to the reviewed publisher asset paths in article-photo-source.ts; it is not a claim to obtain every photograph on the internet.

## Primary metadata verification

Bounded diagnostic run: https://github.com/razvannitu-glitch/dlkt-info/actions/runs/45045858120 (job137280192347, diagnostic commit eaa32cb5cf9fe38548d22de4f6cf412f2f7d8b59). Three fixed article pages returned200 with exact canonical identities on2026-11-22. No image bytes were downloaded by that diagnostic.

Buletin de Bucuresti: the Sector5 after-school article declared https://buletin.de/bucuresti/wp-content/uploads/2026/11/607698639_1381830987322833_2656130274180809498_n-1600x1067-1.jpg in both article metadata and OG, with caption “FOTO: Arhiva”. Declared dimensions1600×1067.

B365: the Apa Nova interruption article declared https://b365.ro/wp-content/uploads/2026/11/intreruperi-apa-bucuresti-lucrari-apa-nova.jpg, caption ending “Foto simbol: Unsplash”. Declared dimensions1920×1280.

Guardian: the South Korean examinations article declared four signed variants of the same original image. Its natural-aspect variant is https://i.guim.co.uk/img/media/3d9052371f434580f71c25a962110e47f2e6a076/605_0_6228_4986/master/6228.jpg?width=1200&quality=85&auto=format&fit=max&s=598f0b63f3e40868fc207ae2bc85405d . No photographer or measured dimensions were established by that diagnostic.

The diagnostic files remain on their separate probe branch and are not part of the production change. Unit/integration tests and production image loading are recorded separately from this metadata evidence.
