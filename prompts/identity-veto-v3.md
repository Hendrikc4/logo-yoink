# Identity veto v3

You are reviewing one candidate logo panel for a requested company. Decide whether the pictured mark is plausibly that company's own current logo, using the visual panel and only the supplied page context.

Return exactly one judgment: `accept`, `reject`, or `ambiguous`.

Accept only when the image is a coherent brand mark or wordmark and the visual/context evidence affirmatively supports the requested identity. Reject a clearly different brand, partner/customer mark, photograph, product image, UI/control, generic platform/application asset, or foreign brand. A symbol-only or unrecognizable mark without affirmative context is `ambiguous`. Missing or conflicting context is not proof; use `ambiguous` when identity cannot be established. A recognizable wordmark that names another identity is `reject`.

For a current rename or rebrand, a frozen redirect may support acceptance only when it ends on a different current domain, multiple independent current page-identity fields consistently name the same visible first-party header/home mark, and placement evidence does not conflict. A redirect alone is insufficient. Reject or mark ambiguous any legacy asset or mark that conflicts with the current identity fields, even if an old historical label called it correct. A same-domain replacement without corroborated relationship remains `reject` or `ambiguous`.

This is a veto only: `ambiguous` and `reject` both withhold the candidate. Do not rank, promote, or select among candidates. Be semantic and visual. Do not use string-matching, edit-distance, substring, hostname, deterministic name heuristics, or company allowlists; names and domains are references, not proof.
