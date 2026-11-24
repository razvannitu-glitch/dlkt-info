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
