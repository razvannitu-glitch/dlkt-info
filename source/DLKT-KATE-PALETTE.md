# DLKT — brand palette and approved reader themes

The canonical DLKT brand identity retains these three colors:

- Black — `#000000`
- White — `#FFFFFF`
- Coral — `#F66061`

The original brand assets and shared base stylesheet retain this palette. Their neutral surfaces, borders, muted text, shadows and interaction states use alpha transparency or `color-mix()` combinations derived from these colors.

Coral is the identity signal. Coral backgrounds use black text where required for readable contrast. Small coral text on white may use an accessible dark mix derived exclusively from coral and black. Black surfaces use white text and coral signals.

## Approved reader appearance extension — 22 November 2026

The user approved Prism soft as the default reader appearance and Night coral as an optional dark appearance, following the visual examples. This is an explicit extension for the public reading interface and its cards. It does not change the logo, favicon, PWA identity, transactional templates, social images or other DLKT projects.

Prism soft uses a cool pale page (`#F4F5FA`), white cards, dark ink (`#1D2133`), violet actions (`#5643B6`), lavender hover (`#D8D1FF`) and mint saved states (`#BDE9DD`). Night coral uses a dark page (`#14181C`), dark cards (`#20262C`), light ink (`#F4F3EF`), coral actions (`#F66061`) and mint saved states (`#BEEBDD`). The coral brand accent remains unchanged in both themes.

`public/reader-theme.css` owns this scoped appearance layer and loads after the existing reader styles. Images retain their original colors. Photo overlays use explicit, contrast-checked physical ink and backgrounds independently of the semantic page colors. Focus, hover, saved and image-fallback states must remain legible in both themes.

The public reader starts in Prism soft. The native appearance control changes only the page theme. A manual choice is stored under `dlkt-reader-theme-v1` for the current browser origin and restored before styles paint; there is no automatic write on a first visit, account synchronization or content-profile change. Storage failure leaves the control usable on the current page. All supported interface locales provide the next-action label.

Future color expansions beyond this approved reader layer still require an explicit brand decision. Existing identity and release gates remain in place.
