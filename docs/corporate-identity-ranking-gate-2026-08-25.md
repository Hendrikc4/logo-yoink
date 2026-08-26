# Corporate-identity ranking gate — 2026-08-25

## Decision

Promote ranking v9's deterministic corporate-identity gate. It removes the
three remaining reviewed wrong-brand domains in development without a
company-specific allowlist, a broad DOM-source demotion, or an AI veto.
Validation has no changed selection and no regression. No evaluation row was
inspected, printed, scored, or used for this decision.

The runtime change uses three related signals:

1. An unlinked asset whose accessible label explicitly names another
   organization is rejected only in product, menu, carousel, customer, or
   partner context. A shared requested-name token preserves localized and
   regional marks, and `home_linked` evidence remains authoritative regardless
   of asset host.
2. An exact requested-organization label receives a six-point preference over
   product or subbrand labels that merely contain the requested name.
3. A generically named application icon can cause a canonical icon abstention
   only when it is an unplaced declared icon, its normalized asset family has no
   Schema.org or other authoritative corroboration, and no eligible icon family
   has authoritative, exact-name, or home-link evidence. The independently
   ranked legacy favicon is unchanged.

The third rule deliberately returns no canonical icon for one development
domain rather than presenting an app identity as the corporate identity. It is
not a general demotion of Apple-touch, manifest, HTML-icon, DOM, CDN-hosted, or
localized assets.

## Frozen evidence and split discipline

The offline replay used the existing current-main candidate snapshots under
`/Users/hendrik/Documents/logo-yoink/runs/major-brands-embedded-logo-fix`.
No network request, browser invocation, candidate discovery, model call, or
frozen artifact write occurred. The ignored replay output is under
`runs/corporate-identity-gate/current-{development,validation}`.

| Immutable input | SHA-256 |
| --- | --- |
| Development results | `be969d0aa7f9e5e750ec8cfbe06a72ed280ec3d7307149f4ac1b74e599988d4e` |
| Development scoring labels | `423134c87319848a602e7869b113ca56dc1c1316c6eaa736ca47e10afb3fb18b` |
| Development split | `6750e75ba64306dbf7784661c5c317bb2635b6a6149790b377dfe3d1b9abe720` |
| Validation results | `96038b6c04361c95dfbe5e66304867d3a6652d164e237b6811946a87917c38ac` |
| Validation scoring labels | `177a86a83117077c893487e0e07b9623eeba27141543e1994731481391c75fd5` |
| Validation split | `55568d6b5bdaf25713afe11d53778d2e9258d68d8e30c3338856f2f66186d25a` |

All three motivating cases are assigned to development. The rule and thresholds
were frozen after the development replay. Validation was then used only for
confirmation. No evaluation split or scoring command was invoked.

## Results

| Split | Score | Correct icon | Correct wide | Wrong-brand domains | Icon answers | Wide answers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Development before | 64.51 | 97 | 65 | 3 | 125 | 81 |
| Development v9 | **67.05** | **98** | 65 | **0** | 124 | 80 |
| Validation before | 68.99 | 37 | 23 | 0 | 45 | 30 |
| Validation v9 | **68.99** | 37 | 23 | 0 | 45 | 30 |

Development has five changed slots, all reviewed from the exhaustive
development labels:

| Domain | Role | Before | After | Outcome |
| --- | --- | --- | --- | --- |
| Samsung | Icon | Non-corporate declared app icon | Abstain | Removes wrong brand |
| Dropbox | Icon | Reclaim.ai navigation product mark | Exact-labeled Dropbox mark | Adds one correct selection |
| GitLab | Wide | HackerOne customer-carousel mark | Abstain | Removes wrong brand |
| Block | Icon | Correct home-linked mark | Correct exact-labeled mark | Neutral same-brand variant |
| SourceForge | Wide | Correct home-linked mark | Correct exact-labeled mark | Neutral same-brand variant |

There are zero correct-to-non-correct regressions and zero new wrong-brand
domains. Development answer count falls by two slots, exactly the two cases
where no eligible corporate-role replacement survived. Validation has no
movement at all. The prior embedded-logo rule, not v9, accounts for the Apple
and BMW product-image abstentions seen when comparing against the older v6
snapshot.

## Adversarial checks and limits

Focused tests cover official assets on third-party CDNs, a localized official
label with extra regional wording, home-linked marks whose accessible name does
not match the requested name, exact company labels versus related product
labels, application icons corroborated by authoritative metadata in the same
normalized URL family, and a separate home-linked corporate icon family.

Known limits remain:

- Validation's zero movement confirms non-regression but does not independently
  demonstrate positive yield.
- The explicit-name comparison tokenizes Latin letters and digits; it is not a
  general transliteration or corporate-ownership resolver.
- Asset-family corroboration is based on normalized delivery URLs, not visual
  similarity. It intentionally does not infer ownership across unrelated URLs.
- The application-icon abstention recognizes only generic `app_ico`,
  `app-icon`, or `application-icon` filenames. Broader app/product heuristics
  were not justified by development evidence.
- This is a frozen-candidate ranking qualification. It makes no claim about
  live-site drift, discovery recall, or an untouched evaluation score.

## Reproduction

The ranking replay itself is:

```sh
node scripts/experiments/rerank-run.mjs \
  /Users/hendrik/Documents/logo-yoink/runs/major-brands-embedded-logo-fix/development \
  runs/corporate-identity-gate/current-development
node scripts/experiments/rerank-run.mjs \
  /Users/hendrik/Documents/logo-yoink/runs/major-brands-embedded-logo-fix/validation \
  runs/corporate-identity-gate/current-validation
```

The source run's `summary.json` and split-scoped exhaustive `scoring.jsonl` are
then copied into each ignored replay directory, selected-role scoring labels
are regenerated with `selected-role-scoring-adapter.mjs`, and the normal
`benchmark.mjs score` command produces the figures above. Repository release
qualification is `npm run check`.

The release safeguard requires the qualification metadata to acknowledge every
runtime ranking version. The v9 change updates only
`acknowledged_runtime_ranking_version`; captured ranking v3, its published
metrics, canonical roles, and `qualifies_current_runtime: false` remain
unchanged. No frozen measurement or input is rewritten.
