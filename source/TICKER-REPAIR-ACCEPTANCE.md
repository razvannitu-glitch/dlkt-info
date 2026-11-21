Current ticker requirements: MOBILE-TICKER-ACCEPTANCE.md supersedes the inline Pause/Resume/Play control, static-until-Play startup and persisted pause behavior below. Those statements describe historical acceptance only; the current user explicitly requires automatic startup and no inline ticker button. All unrelated acceptance remains in force.

# Ticker repair acceptance — 2026-11-18

This release continues DLKT INFO from f0b5c4018ad072a4bf1ca4212d6dbf27934ac243. The user explicitly requested repair of Today at a glance while retaining the existing requirements. This document defines the acceptance boundary; execution reports are retained separately.

## Reproduced defects

The existing public release remained paused after a mouse opened and closed Read updates. Manual Pause was lost after reload in the same tab. A separately labelled controlled browser fixture demonstrated a jump when changed content width was mapped through old fractional animation progress. Live observations and fixtures are distinct evidence.

## Required behavior

Retain the full-width dark 44 CSS px ribbon, existing coral accents, one horizontal sequence, 28 CSS px per second right-to-left motion, and seamless repetition. Preserve the existing layout, branding and source rules. No KEY THINGS label is added.

Explicit Pause and Play choices persist for the current tab session. Pointer focus must not leave the ribbon stuck after a dialog closes, while keyboard focus, hover, touch interaction, open dialogs and hidden pages still pause appropriately. Reduced motion starts with the same narrow manually scrollable row and offers explicit Play. Clearing saved preferences clears the motion choice.

Updates and resizing preserve travelled pixel distance without gaps or nonfinite animation values. Empty content hides safely and repopulation works. Read updates remains available with source and date context. Source refreshes and city changes must not retain another city's stale information or extend a source's validity.

## Verification boundary

Require focused regression tests, the unchanged full release gate, independent raw-diff review, and exact-commit protected-preview browser acceptance at widths 320, 390, 768 and 1440. Public aliases are changed only after these checks pass, then their delivered assets and APIs are verified against the exact candidate. Browser-only fixtures are labelled as simulated; screenshots are internal verification evidence.

## STB source gate

The proposed automatic STB integration is blocked, not delivered. The official terms at https://www.stb.ro/termeni-conditii were read on 2026-11-18. Section 2 requires prior written permission for republication/retransmission and restricts commercial reproduction/storage. No permitted reuse basis has been confirmed. Access to the public page is not treated as permission to activate a commercial feed. No STB parser, connector, transport coverage claim or automated source polling is included in this release. This records the source's declared conditions; it is not a general conclusion that factual information is itself protected.
