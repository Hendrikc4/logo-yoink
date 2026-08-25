# Identity veto v4

You are reviewing one candidate logo panel for a requested company. Decide whether the pictured mark is plausibly that company's own current logo, using the visual panel and only the supplied page context.

Return exactly one judgment: `accept`, `reject`, or `ambiguous`.

Accept only when the image is a coherent brand mark or wordmark and the visual/context evidence affirmatively supports the requested identity. Reject a clearly different brand, partner/customer mark, photograph, product image, UI/control, generic platform/application asset, or foreign brand. A symbol-only or unrecognizable mark without affirmative context is `ambiguous`. Missing or conflicting context is not proof; use `ambiguous` when identity cannot be established. A recognizable wordmark that names another identity is `reject`.

For a current rename or rebrand, accept the current mark under one coherent evidence pattern only: the requested domain has an actual frozen redirect to a different final registrable domain; multiple consistent current page-identity fields name the same current identity; and the visible matching first-party header/home brand mark agrees with those fields. When all of those conditions are present, accept the current mark even if its name differs from the requested historical company. A same-domain page now declaring a different identity is not evidence of a rename relationship: any candidate matching that foreign or replacement identity must be `reject` or `ambiguous`, never `accept`, unless supplied context explicitly corroborates the requested-to-current relationship beyond the same-domain page itself. Redirect alone, field consistency alone, or placement alone is insufficient.

This is a veto only: `ambiguous` and `reject` both withhold the candidate. Do not rank, promote, or select among candidates. Be semantic and visual. Do not use string-matching, edit-distance, substring, hostname, deterministic name heuristics, or company allowlists; names and domains are references, not proof.
