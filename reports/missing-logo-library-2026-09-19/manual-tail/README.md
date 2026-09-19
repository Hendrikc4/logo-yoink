# Final manual recovery review

This follow-up starts from the 57 empty identities remaining after commit `b8f416b` and preserves the previous 131 recovered identities. Each of the 57 now has one manually inspected, correctly identified asset. The original 188-identity assignment therefore has 188 recovered identities and 191 approved assets.

## Review scope

- `baseline.json` records the exact 57-identity scope before changes.
- `candidates.json` records curated source URLs, downloads, and retrieval failures. This was targeted source research, not another general homepage crawl.
- `review-index.json` and the light/dark PNG sheets include accepted and rejected candidates. Native raster dimensions are preserved in review; vectors are rendered at 144 DPI.
- `decisions.json` is authoritative for the selected candidate, role, theme, identity evidence, rationale, and applicable usage notes for every identity.
- ICO files are decoded to PNG without artwork changes; the transformation and source hash are recorded. No generated or reconstructed logos are used.
- Small native icons are accepted only when recognizable, as expressly permitted by the task. An icon-only approval is not a full wordmark-role completion.

## Availability versus usage rights

Approval here means identity and visual usability, not certification of trademark/copyright permission for future use. Publicly available artwork is recorded as found even when the owner's usage guidance requires authorization. Concrete restrictions remain in `usageNote`; no restricted account, login, CAPTCHA, or access control was bypassed, and nothing was published externally.

The Carrefour emblem comes from the public site's access-error header, not the gated media library. DigitalOcean's downloaded attribution SVG was verified byte-for-byte against the horizontal blue SVG in the logo ZIP currently linked by its official press page (SHA-256 `0fddb71cc6f7e81e85e7ae587aaadf98e789f81dce422903faad4631f988fc63`).

Rejected substitutions remain visible in the candidate sheets: Hasbro versus its product brands; Malaysia Airlines versus Malaysia Aviation Group; Polo versus Ralph Lauren Corporation; US Bank versus U.S. Bancorp; the three-brand ibis family versus ibis itself; and the PetroChina/SKK Migas co-branded header versus the standalone PetroChina identity.

Earlier report artifacts and withdrawal notes are historical. The later `missing-logo-manual-tail-review` notes and approval-history record supersede earlier unresolved outcomes; root `report.json`, `outcomes.json`, `residual.tsv`, and final-review sheets reflect the completed assignment.

## Validation

- Full library: 1,000 identities populated; 1,170 approved immutable assets verified.
- All 943 identities outside this 57-identity baseline are JSON-identical to the pre-change manifest, including the 131 previously recovered identities.
- All 485 tests passed; frozen 500-company and expanded 800-company fixtures validated.
- Syntax checks and `git diff --check` passed.
- Final assignment contact sheets regenerated for 191 assets across 188 identities; zero unresolved identities.
