# DLKT Info 0.8.8 — Visual Review Console

The protected staging product now contains a dedicated visual preview at `/review`. It explains the internal review mechanism without exposing or requiring a real database, a review secret, source payloads or real claims.

The console is structured as three deliberate zones: a private change queue, a finite InfoCard inspection surface and a human decision panel. The selected candidate shows the direct answer, why it matters, the verified before/after delta, materiality, trust, relevance, evidence and the exact previous/current claim relationship.

The preview contains three explicitly synthetic candidates covering a changed claim, a new claim and a contradiction. All source URLs use reserved `.example` domains. The page makes no factual claim about a real legal document and performs no external request.

Approval and rejection are interactive but session-local. They update only the in-memory synthetic queue and append a preview audit event. No cookie, local storage, indexed database, user account, RPC, outbox item, public InfoCard, email, push notification or delivery job is created.

The visual system uses only black `#000000`, white `#FFFFFF` and coral `#F66061`. Desktop, tablet and mobile layouts preserve the same hierarchy. Keyboard controls support `J` and `K` for navigation and `A` and `R` for decisions.

The route remains protected by Vercel Authentication, non-indexable and staging-only. It is a product comprehension surface, not the internal production console. A later authenticated console will consume the private review queue only after the dedicated DLKT Info Supabase project is provisioned and security replay is complete.
