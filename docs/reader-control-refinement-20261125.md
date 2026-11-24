# Reader control refinement — 25 November 2026

## Task contract

**objective**

Refine DLKT control geometry and page consistency without changing its palette, content or authentication.

**source**

```json
{
  "repo": "razvannitu-glitch/dlkt-info",
  "sha": "ae1fe1f459a3bcb22f30d7ff2dce38d66dc95baa",
  "live": "https://www.dlkt.ee/"
}
```

**findings**

- Photo-unavailable category labels compute to navy background with zero padding (confirmed live DOM).
- Account markup uses unstyled workspace/controls containers.
- Explore destination buttons and coverage summary use40/36px minimums; fields use15px text.
- Article source action has flex automatic minimum and needs explicit wrapping for enlarged or long text.

**scope**

- source/public/editorial-cards.css
- source/public/iceo.css
- source/public/explore.css
- source/public/account.html
- scripts/qa-browser.mjs

**protected**

- Palette,logo,full titles,original URLs,source dates,grouping/pagination,account privacy/auth,keyboard navigation,zoom availability,existing CI gates.

**acceptance**

- Filled category labels retain horizontal and vertical inner space with and without photos.
- Long CTA text stays fully inside its action; icon targets remain44px.
- Account content has responsive gutters and bounded form width.
- Explore controls/disclosures >=44px; form text>=16px.
- Normal viewports320–1440 plus440DPR3, separately labelled200% typography stress, existing light/night and functional gates.

**negatives**

- Do not mask overflow with page overflow-x:hidden, shrink text to fit, disable zoom, hide long titles, or persist received-but-unseen articles.

**environment**

Existing GitHub Actions/generation only; no shell calls, new dependencies or infra; exact source pin and release receipt.

**resourceBoundary**

One generation run and one candidate CI suite; retry only after demonstrated cause or release environment change. Independent review before merge.

## Baseline evidence

Official DOM at the source above: category labels with a working photo have `padding: 6px 9px`; the `photo-unavailable` state has navy background and `padding: 0px`. The measured desktop document had clientWidth and scrollWidth both 1348px, innerWidth1363px, DPR1 and visualViewport.scale1. The user's enlarged Safari preview is not sufficient evidence of normal-width page overflow. Zoom remains available.

## Editorial continuity audit

Existing tests already cover the user's three Iranian-singer originals and preserve all original URLs in one group. Within-document pagination and edition refresh have continuity. Seen aliases are not persisted across visits; they also include received cards that may still be below the viewport. Persisting that set directly would hide unread cards. A later, separately reviewed continuity change must track actual observation, retain access to previous reading, validate and bound device memory, and handle blocked storage. This refinement does not claim to solve cross-visit history or universal semantic deduplication.

## Shared account surfaces

The official account baseline was also inspected: main and `.controls` extended from x0 to1363px, including the email field. Account and Wallet omitted the existing appearance bootstrap and final palette. Both now reuse `/reader-theme.js` before CSS and `/reader-theme.css` last, preserving the explicit saved appearance without adding another storage key or authentication behavior. The account gets bounded form width and responsive gutters. Scope includes `source/public/wallet.html` for this shared theme inclusion only.

## Initial verification and corrected contracts

Generation at `ead18c27e2e5e3ec45f275d2c460a1c865483bb0` passed strict TypeScript, 52 packaging tests and 2433 of2436 application tests. Three failures identified stale visual test contracts: the palette token regex read the beginning of `#account` as `#acc`, the authorized shared CSS fingerprint had changed, and Wallet's exact stylesheet list needed the existing reader theme. The fixes retain the palette whitelist and add a negative case for a genuinely new color, update only the independently recalculated CSS fingerprint, and explicitly require synchronous appearance bootstrap plus final stylesheet order. Auth, privacy, Kate and header checks remain intact. A new generation run follows these demonstrated fixes.

## Generated candidate evidence

Generation run `45500104249`, job `138820791455`, completed successfully from exact authored commit `a03772c1b644f34c2c030c18e2ff826371498714`. Strict TypeScript, 2437 application tests, 52 packaging tests and the dependency audit passed (0 vulnerabilities reported). The bounded export was independently decoded and verified for chunk order, byte count, SHA256, exact input commit, allowed paths, baseline hashes, complete source pin, unchanged release metadata, manifest consistency and news-registry projection. Source hash: `415b8b112674099f7f21bbe87e9c2d30baaac25a17cf963d4f91f8c3c8d0b6e0`. Manifest hash: `6fb2682f10b3ffdd046fb30d3cfcab9a689383484015d982d5a7a64945313857`.

The separate browser QA change retains the existing normal geometry gate byte-for-byte and adds badge/CTA measurements, 440px/DPR3, labelled typography stress, Explore and anonymous Account Night. Root and an independent reviewer found no blocking source issue. Browser execution and post-publication checks remain required; this document does not substitute their results.
