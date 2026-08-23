# Homepage Logo Hunt implementation plan

## Status

- Planning document only; this file does not authorize or contain the implementation.
- Visual direction: the nocturnal flashlight hunt shown in `docs/design/logo-hunt-sequence/01-opening-hunt.png` through `04-the-20-footer.png`.
- Explicitly excluded: the name **The Webglades**, the scenery-shift concept, multiple biomes, a **Skip game** control, real wildlife, and any API-related product claim.
- The homepage must keep a visible **Free & open source** message, a prominent link to <https://github.com/Hendrikc4/logo-yoink>, and an always-visible bottom anchor reading **Scroll down to learn more ↓**.

## 1. Outcome

Replace the current static top hero with a small, instantly playable logo hunt. The player moves a flashlight around one dark digital-marsh scene and clicks roaming logo creatures built from a curated local set of recognizable company marks. A successful click produces a brief illustrated grab and reveals a playful species name such as *Favicon minimus* or *Iconus squarus*. Occasionally, a very large horizontal wordmark—the **20-footer**—crosses the scene as a rare encounter.

The game is an Easter egg and brand introduction, not the product itself. Scrolling continues naturally into a concise explanation of Logo Yoink, the real website input, ranked results, and the open-source/GitHub call to action.

Success means:

1. A first-time visitor understands the interaction within a few seconds.
2. The game is fun with pointer, touch, and keyboard input.
3. The real logo finder remains obvious immediately below the fold.
4. The whole page feels like one product, not a game pasted above the existing interface.
5. The game adds no backend dependency and does not compromise extractor behavior or performance.

## 2. Product decisions

### 2.1 Keep the scope intentionally small

- One fixed digital-marsh scene only.
- Five core species plus the rare 20-footer for the first release.
- At most six ordinary creatures active on desktop and four on mobile.
- No game-over state, levels, accounts, leaderboard, server persistence, inventory economy, audio requirement, or multiple scenery system.
- A session score, streak, and field-guide count are enough.
- The game begins in an idle state and starts only after an explicit **Start hunt**, click/tap, or keyboard activation. Merely moving a pointer across the hero does not begin scoring.
- No **Skip game** button. **Scroll down to learn more ↓** links to `#about` and is visible throughout the game.
- No audio in v1.

### 2.2 Use a curated local set of real company logos

Recognition is part of the fun. The target catalog is 18–24 locally stored, recognizable company or open-source-project marks, including OpenAI and Anthropic if their recorded usage basis passes the release gate below.

- Do not hotlink logos or fetch them at game runtime.
- Source exact marks from official company brand resources when available; otherwise use Logo Yoink to discover candidates and manually approve the correct asset.
- Preserve official proportions and do not ask an image model or coding LLM to redraw a complex company logo.
- Divide candidates into **Tier A** (official guidelines or an explicit license permit the intended third-party/editorial use) and **Tier B** (usage basis requires a documented product/legal decision). Ship Tier A by default; Tier B does not ship merely because it is recognizable.
- Store approved local runtime copies with provenance, source URL, capture date, original format, `licenseBasis`, `approvedBy`, `approvedOn`, and `lastVerifiedOn`.
- Provide a catalog-only removal path: deleting or disabling one manifest entry removes a mark without code changes.
- Document a contact/takedown procedure and add a short mark-ownership/non-endorsement note when the catalog first ships.

This keeps the game instant and deterministic while making recognition part of the interaction. A later catalog refresh may use the extractor plus manual approval; it must never silently replace production game assets. The gray-box placeholder catalog must itself be visually good enough to ship so the homepage is not blocked if real-mark approval takes longer than expected.

### 2.3 One scene, variable encounters

Replay variety comes from creature selection, size, path, speed, spawn timing, weather intensity, and rare-event timing—not from loading new scenery. Fog, rain, ripples, and reed movement may vary subtly inside the same scene, but there is no scene-transition architecture.

## 3. Experience flow

### State A: idle hunt

- Full-viewport nocturnal scene.
- Logo Yoink, **Free & open source**, and **View on GitHub** in the top bar.
- Headline: **The logos come out at night.**
- Instruction: **Move your light · Click to yoink**.
- A flashlight reveals a single mysterious creature silhouette.
- **Start hunt** and **Scroll down to learn more ↓** are both available.

### State B: active hunt

- Pointer, touch, or focused keyboard target controls the flashlight.
- Three to six logo creatures move on independent but bounded paths.
- The HUD shows score, streak, field-guide progress, and pause/resume.
- The flashlight conceals creatures; the company mark becomes visible under the light, but its playful species classification remains unknown until capture.

### State C: capture reveal

- The clicked creature pauses and changes to the grab pose.
- A short `YOINKED!` burst appears.
- A compact field note reveals species, format, dimensions, flavor copy, and points.
- The reveal lasts briefly or can be dismissed immediately; the hunt continues behind it at reduced speed.
- The result is announced through an `aria-live="polite"` region.

### State D: rare 20-footer

- Eligible only after a minimum number of ordinary captures and a cooldown.
- Ordinary spawns pause while one oversized wordmark crosses the scene.
- The player holds pointer, Space, or Enter for a short grab meter.
- Success reveals *Wordmarkus giganticus* and a large point reward.
- Failure is harmless; the creature escapes and ordinary play resumes.

### State E: scroll into the product

- The bottom anchor scrolls to `#about`.
- The next section explains what Logo Yoink actually discovers and ranks.
- The existing website form and result grid remain the functional centerpiece below the game.
- The visual system continues with the same dark background, warm text, acid accent, thin olive rules, and field-guide vocabulary.

## 4. Initial species catalog

| ID | Display name | Shape | Behavior | Rarity | Points | Field note |
|---|---|---|---|---:|---:|---|
| `favicon-minimus` | *Favicon minimus* | Tiny square | Fast, short darts and hiding pauses | Common | 40 | “Tiny, quick, and fond of browser tabs.” |
| `iconus-squarus` | *Iconus squarus* | Medium square | Steady hops between reeds | Common | 100 | “Clean edges. Loves app manifests.” |
| `wordmarkus-horizontalis` | *Wordmarkus horizontalis* | Wide | Smooth lateral glide | Uncommon | 160 | “Usually found near headers and home links.” |
| `vector-perfectus` | *Vector perfectus* | Variable crisp mark | Slow glow, then sudden dash | Rare | 300 | “Scales beautifully when startled.” |
| `raster-blurryensis` | *Raster blurryensis* | Pixelated rectangle | Erratic wobble | Common | 20 | “Often larger in confidence than resolution.” |
| `wordmarkus-giganticus` | *Wordmarkus giganticus* / The 20-footer | Extremely wide ribbon | Rare full-screen crossing; hold to grab | Legendary | 2,000 | “The one every logo hunter claims to have seen.” |

The catalog is data, not branching UI code. New approved company marks can reuse a species behavior without adding a new state or component.

## 5. Technical architecture

### 5.1 Keep the existing stack

The repository already uses dependency-free HTML, CSS, and browser ES modules served by a small Node server. Keep that architecture. Do not introduce React, a bundler, a physics engine, a canvas library, or a game framework.

### 5.2 Render with DOM + CSS and local image assets, not canvas

Each creature is a real `<button>` containing an approved local `<img>` asset in its original SVG, PNG, or WebP format. Movement uses `transform: translate3d(...)` from one `requestAnimationFrame` controller. A pointer-events-none darkness layer creates the flashlight with a radial-gradient mask driven by `--torch-x` and `--torch-y`.

Why this is the best fit:

- Native click, focus, keyboard, and screen-reader semantics.
- No separate hit-testing or accessibility mirror.
- Easy responsive behavior and deterministic browser tests.
- Six creatures do not justify a canvas renderer.
- Text and reveal cards remain crisp HTML at every viewport size.

### 5.3 Separate pure game state from the DOM

Use three small modules plus the asset manifest:

- `public/hunt-species.js` — species definitions, movement profiles, scores, and field notes. It never owns real-logo provenance.
- `public/assets/hunt/manifest.json` — approved logo-asset metadata and provenance. The asset team is its sole owner.
- `public/hunt-core.js` — seeded random number generator and pure session, fixed-step spawn/movement, capture, score, streak, rare-event, cooldown, reset, and persistence helpers.
- `public/hunt-ui.js` — DOM creation, animation loop, flashlight input, focus behavior, reveal panel, hold interaction, pause/resume, visibility handling, and wiring to the core.

This is intentionally not a reducer framework, entity-component system, event bus, or general game engine.

### 5.4 Minimal state model

```js
{
  seed,
  rngState,
  status,          // idle | running | paused | revealing | rare
  elapsedMs,
  score,
  streak,
  captures,
  discoveredIds,
  spawnIndex,
  lastRareAt,
  creatures: [
    { id, speciesId, markId, x, y, vx, vy, phase, spawnedAt }
  ]
}
```

Positions use normalized scene coordinates so the same model works across viewport sizes. The core advances with a fixed tick (`TICK_MS`, initially 20 ms). `hunt-ui.js` accumulates real frame time, invokes zero or more fixed steps, and caps catch-up steps after tab sleep. Wall-clock delta never enters game rules.

### 5.5 Deterministic randomness

- Use a tiny seeded PRNG such as `mulberry32` or `xorshift32`.
- Production creates a session seed with `crypto.getRandomValues` and keeps it in memory.
- `?huntSeed=<integer>` overrides the seed for tests, screenshots, and debugging.
- All random draws occur inside the fixed step in a stable order; draws are never conditioned directly on wall-clock timing.
- `?huntForceRare=1` explicitly forces the rare state for QA. Do not depend on a fragile “magic” random seed.
- The first 20-footer is guaranteed at capture five. Later encounters use a cooldown plus seeded selection, never an unbounded low-probability event.
- Pure tests use explicit seeds and step counts.

### 5.6 Page integration

Proposed document structure:

```html
<header class="site-header">…</header>
<main>
  <section id="hunt" class="logo-hunt" aria-labelledby="hunt-title">…</section>
  <section id="about" class="about">…</section>
  <section id="finder" class="extractor">…existing form…</section>
  <section id="results" class="results" hidden>…</section>
</main>
```

- `public/app.js` should retain ownership of extraction submission and result rendering.
- `public/hunt-ui.js` owns only the game section.
- Tighten broad existing selectors such as `header`, `button`, `form`, and `h1` into section-specific classes to prevent game/finder collisions.
- `src/server.mjs` needs MIME types for the production asset formats actually used, likely `.webp`, `.avif`, `.png`, and `.woff2`.
- No new server route or extractor change is required.

## 6. Runtime interaction details

### Flashlight

- CSS mask or layered radial gradients; no raster spotlight asset.
- Pointer movement is sampled once per animation frame and writes only CSS custom properties.
- Keyboard focus moves the flashlight to the focused creature.
- Coarse pointers use a larger radius and at least a 44×44 px hit target.
- The game never makes capture eligibility depend on darkness pixels; the creature button remains the source of truth.
- Creatures outside the visible torch radius retain pointer events. Blind clicks are allowed, and screen-reader/CSS-off access to every active creature is an accepted accessibility consequence.
- Provide a persistent **Lights on** toggle that reveals the whole playfield for low-vision, high-contrast, or lower-cognitive-load play. `prefers-contrast: more` defaults to this mode.

### Movement

- Maximum six desktop and four mobile creatures.
- Movement recipes are small functions: glide, dart, hop, wobble, and rare crossing.
- Each ordinary creature receives a seeded 12–20 second lifetime. An uncaptured creature then escapes and respawns.
- Captures increment the streak; an uncaptured despawn resets it. Pause/offscreen time does not consume lifetime.
- Update transforms only; do not read layout inside the animation loop.
- Use `ResizeObserver` to update scene bounds outside the loop.
- Pause animation when the game is offscreen or `document.hidden`.

### Capture and reveal

- Pointer click or Enter/Space calls the same capture command.
- Captured creature freezes and remains in the DOM in an `aria-disabled="true"` grab pose until its replacement spawns after the reveal. The controller ignores repeat activation while keeping the button focusable.
- Reveal card is a non-blocking `role="status"` field note, not a dialog and not a focus trap. Escape dismisses it while focus stays on or returns to a current creature button.
- If a captured node must be removed early, focus moves to the next creature button in DOM order, never to `body`.
- Repeated clicks cannot score the same creature twice.

### Twenty-footer

- The first encounter is guaranteed at capture five so typical visitors can see the marquee moment.
- Later encounters use an initial tuning target of 30 seconds or 10 captures after the previous appearance, followed by seeded eligibility.
- Hold duration target: 1.0–1.5 seconds.
- Pointer release, key release, window blur, pause, or pointer cancellation safely resets the hold.
- `?huntForceRare=1` is the supported forced-event mechanism; the seed remains responsible for ordinary reproducibility.

### Persistence

- Persist only the local best score and discovered-species IDs.
- Wrap `localStorage` reads/writes in `try/catch`; the game works without storage.
- Do not persist positions, timers, or the active random seed.

## 7. Visual system

### Shared design tokens

```css
--night: #050706;
--night-raised: #0d120d;
--reed: #26351e;
--acid: #d7ff63;
--bone: #f3f1e9;
--mist: #98a095;
--warning: #f3a24a;
--line: color-mix(in srgb, var(--acid) 22%, transparent);
```

- Self-host one Latin-subset WOFF2 of **Bebas Neue** (OFL) for large hunt copy, with `font-display: swap` and tuned fallback metrics. Keep it at 30 KB or less including its license file.
- Use the system sans stack for product prose and the system mono stack for HUD, species metadata, and diagnostics; do not add more font files in v1.
- Use the hand motif, acid capture burst, thin olive rules, field-guide cards, and mono taxonomy throughout the game and below-fold explanation.
- Do not repeat the mockup’s dense decorative elements everywhere. The live version needs more empty dark space around moving targets.
- Keep the hunt headline as the page H1. Give `#about` a strong descriptive H2, while `<title>` and the meta description retain the plain product proposition for search and sharing.
- Size the hunt with `min-height: 100svh` (and `100dvh` where supported). On landscape screens shorter than 560 px, use a 560 px minimum playfield and normal document scrolling rather than compressing controls.

### Uniform page transition

The game scene fades into the below-fold content through the same grid-water lines and dark palette. The first content section should explain the joke in one sentence, then explain the product plainly. The extractor retains the acid primary action and field-guide-style result metadata so it feels like the useful continuation of the hunt.

## 8. Production asset plan

ImageGen should create atmosphere and character art, not baked-in UI or runtime text. All masters and prompts must be stored or documented so later poses can match.

### ImageGen assets to generate later

| Asset | Master | Runtime exports | Requirements |
|---|---:|---:|---|
| Digital-marsh background | 2560×1440 PNG master, not committed | Desktop AVIF/WebP | Text-free, logo-free, no hand, no flashlight, dark edges, open center playfield |
| Mobile background crop | 1440×2560 PNG | Mobile AVIF/WebP | Same scene and palette; composition adapted rather than mechanically cropped |
| Midground reeds/code signs | 2560×1440 transparent PNG | WebP/PNG | Sparse HTML-tag reeds and ripples; no readable product copy |
| Hand—open/search pose | 1024×1024 transparent PNG | WebP/PNG | One reusable pointing/search pose; same sleeve, perspective, line work, and skin tone as grab pose |
| Hand—grab pose | 1024×1024 transparent PNG | WebP/PNG | Thumb/index pinch around a replaceable empty center |
| Creature frames—tiny, square, wide, vector, blurry | 1024×1024 transparent master sheet or separate masters | WebP/PNG | Consistent illustrated shells and motion accents with empty centers for runtime logo compositing |
| 20-footer ribbon | 2048×512 transparent PNG | WebP/PNG | Flexible illustrated body with an empty compositing area for a real wide mark; no baked-in company logo or species text |

Generate the two hand poses from one approved reference and validate them together before implementation accepts them. The hand must not contain a logo baked into the pixels; creatures remain separate DOM/image elements. Use CSS for the edge vignette, grain/fog, and capture burst in v1. Full-resolution ImageGen masters are not committed; store the prompt, approved reference preview, crop instructions, and runtime derivatives.

### Curated real-logo assets

- Start with 18–24 approved marks covering square icons, tiny favicons, and wide wordmarks.
- Treat OpenAI and Anthropic as priority candidates for the initial catalog, subject to the same recorded approval gate as every other real mark.
- Prefer the official asset as supplied. If an official source is SVG, preserve it rather than recreating it. If it is raster, keep a high-resolution transparent PNG/WebP derivative.
- Normalize only transparent padding, maximum display bounds, and runtime file size. Do not alter the mark, colors, or proportions.
- Ship one approved variant per mark for the single dark scene. Do not build a theme-variant system in v1.
- Store these under `public/assets/hunt/logos/` and reference them declaratively from the catalog.

### Code-native assets

- Limit hand-written SVG to simple, inspectable geometry: flashlight/focus rings, progress meter, basic HUD icons, and possibly the empty 20-footer motion path.
- Keep readable text—including `YOINKED!`, species names, score, and instructions—in HTML/CSS rather than inside generated images.
- Use CSS for simple fog, rain, glow, noise, and ripple effects only when it is shorter and visually equivalent to an asset.

Do not make an LLM produce complex logo SVG paths or intricate production illustrations in code. ImageGen establishes the scene, hand, creature shells, and 20-footer art; official/local logo files supply exact company marks; HTML/CSS supplies readable interface text and simple effects.

### Asset processing and provenance

- Use the existing `sharp` dependency for resize, crop, AVIF/WebP export, and size validation.
- Add a small repeatable optimization script rather than committing manual one-off conversions.
- Store final runtime assets under `public/assets/hunt/`.
- Store a manifest beside them recording filename, purpose, source master, source prompt/reference, dimensions, format, and byte size. Real-mark entries additionally require `tier`, `licenseBasis`, `approvedBy`, `approvedOn`, `lastVerifiedOn`, `sourceUrl`, and `removable`.
- Do not ship the existing composited mockup PNGs; they remain design references under `docs/design/`.

## 9. Expected file changes

```text
public/
  index.html                         # Game section + below-fold structure
  styles.css                        # Shared page tokens and existing UI, scoped
  app.js                            # Extraction only; minimal selector updates
  hunt.css                          # Game-only styles
  hunt-species.js                   # Species behavior, score, and field-note catalog
  hunt-core.js                      # Pure deterministic game rules
  hunt-ui.js                        # DOM controller and animation/input loop
  assets/hunt/
    manifest.json
    scene-desktop.avif|webp
    scene-mobile.avif|webp
    scene-midground.webp
    hand-search.webp
    hand-grab.webp
    creature-frames/*.webp
    twenty-footer.webp
    logos/*.{svg,png,webp}
    fonts/bebas-neue-latin.woff2
    fonts/OFL.txt
scripts/
  optimize-hunt-assets.mjs          # Repeatable Sharp transforms and budgets
src/
  server.mjs                        # Static MIME/cache handling, landed in wave 0
test/
  hunt-core.test.mjs                # Pure deterministic logic
  homepage-smoke.test.mjs           # Static assets and basic server behavior
  homepage.e2e.mjs                  # Focused Playwright flows if kept separate
docs/
  homepage-logo-hunt-implementation-plan.md
```

Do not touch extractor discovery/ranking files for this feature. The current worktree already contains unrelated extractor work; every implementation team must preserve it.

## 10. Multi-thread Codex implementation plan

Each Codex task is its own team in an isolated worktree and branch using the `codex/` prefix. The lead/integration task freezes interfaces first, dispatches work, owns `package.json` and `src/server.mjs`, resolves merges, and reviews Team 3’s shared homepage changes. No other team edits `package.json`; requested script changes go through Team 0.

### Contract freeze before parallel work

Commit or communicate one short contract containing:

1. Species object schema and exported catalog names.
2. `hunt-core.js` exported function signatures.
3. Required game DOM IDs/classes and custom events.
4. CSS token names.
5. Asset filenames, transparent padding rules, and aspect ratios.
6. `?huntSeed=<integer>` parsing contract and the independent `?huntForceRare=1` QA override.

No team may independently rename these contracts after work starts. Proposed changes go to the lead.

### Team 0 — Lead and integration

**Owns:** architecture contract, `package.json`, `src/server.mjs`, branch coordination, final merges, conflict resolution, end-to-end verification, and this plan. It is reviewer-of-record—not co-author—for Team 3’s homepage integration files.

**Does not delegate:** final product decisions, shared contract changes, or acceptance sign-off.

**First actions:**

- Record the baseline test and dirty-worktree state. Do not stash, commit, or move existing extractor work without its owner’s authorization.
- If the current extractor changes are not committed, stop before creating implementation worktrees and ask the user/owner to place them on a named branch. All teams must branch from an agreed clean commit.
- In two standalone wave-0 commits, scope the legacy global selectors and add static MIME/cache support. Verify the extractor UI after the selector commit before adding game code.
- Create the integration branch/worktree only after those gates are satisfied.
- Freeze the contract above.
- Create the parallel tasks below with exact path ownership.

### Team 1 — Visual system and assets

**Owns only:** `public/assets/hunt/**`, `scripts/optimize-hunt-assets.mjs`, and asset-specific notes.

**Work:**

- Convert the approved visual reference into a production asset brief.
- Generate and review the background plus consistent hand poses with ImageGen.
- Source and verify the curated real-logo set; generate creature frames and the empty 20-footer ribbon without redrawing company marks.
- Optimize responsive exports and enforce byte budgets.
- Write the asset manifest and provenance.

**Can start immediately:** yes, using frozen filenames and transparent bounds.

### Team 2 — Game core

**Owns only:** `public/hunt-core.js`, `public/hunt-species.js`, `test/hunt-core.test.mjs`.

**Work:**

- Implement seeded RNG, spawn selection, movement steps, bounds, capture/scoring, streaks, discovery, persistence parsing, rare gating, cooldown, and reset.
- Supply only simple geometric placeholder marks in tests if the approved logo catalog is not ready; do not reproduce company logos in code.
- Make every rule testable without the DOM or timers.

**Can start immediately:** yes, after the species/core contract is frozen.

### Team 3 — Homepage, interaction, and accessibility

**Owns only:** `public/index.html`, `public/styles.css`, `public/app.js`, `public/hunt.css`, `public/hunt-ui.js`.

**Work:**

- Build the page shell, game DOM, flashlight, creature buttons, animation controller, capture reveal, 20-footer hold interaction, responsive rules, pause/resume, reduced-motion behavior, and below-fold content.
- Preserve extraction behavior. The legacy selector-scoping prerequisite has already landed in wave 0; do not combine further unrelated cleanup with game work.
- Work against CSS placeholders and the frozen core interface; do not wait for final generated art.

**Can start immediately:** yes. This is the sole team allowed to edit homepage integration files.

### Team 4 — QA and performance

**Owns only:** `test/homepage-smoke.test.mjs`, focused Playwright QA files, and final QA notes.

**Work:**

- Add static/server smoke coverage.
- Exercise desktop, mobile, keyboard, touch, reduced motion, visibility pause, scroll anchor, extractor submission, `?huntSeed`, and `?huntForceRare=1`.
- Reuse the repository’s existing Playwright dependency. Browser screenshots are temporary/CI review artifacts, not committed files, and visual checks are not brittle pixel-perfect gates.
- Assert asset sizes against manifest-declared budgets and assert that homepage play makes zero cross-origin requests.

**Starts in wave two:** after Teams 1–3 have reviewable branches. It may prepare test scaffolding earlier but should validate integrated behavior, not invent interfaces.

### Parallelization waves

```text
Wave 0: Team 0 protects existing work, scopes selectors, adds MIME/cache handling,
        verifies the extractor, then freezes contracts and baseline
             │
             ├──────── Team 1: assets ────────────┐
Wave 1:      ├──────── Team 2: core + unit tests ─┼─> Team 0 integration
             └──────── Team 3: UI + homepage ─────┘
                                                      │
Wave 2:                                      Team 4: QA/perf
                                                      │
Wave 3:                                      Team 0 fixes + sign-off
```

Recommended merge order: wave-0 prerequisites, game core, homepage/UI with placeholders, production assets, then QA changes. This exposes functional problems before art polish and minimizes shared-file conflicts.

### Merge-conflict map

| File | Sole owner | Rule |
|---|---|---|
| `package.json` | Team 0 | No other team edits it; teams request scripts or dependency changes |
| `src/server.mjs` | Team 0 | MIME and one-hour cache/ETag behavior land in wave 0; extractor routes remain untouched |
| `public/index.html` | Team 3 | Asset filenames and DOM contract are frozen before work starts |
| `public/styles.css` | Team 3 after wave 0 | Token definitions live in `:root`; Team 0 lands the selector-scoping prerequisite first |
| `public/assets/hunt/manifest.json` | Team 1 | Append/update asset metadata only; Teams 2–4 read it but never write it |
| `public/hunt-species.js` | Team 2 | Behavior and scoring only; no asset provenance |

Static cache policy stays simple: `assets/hunt/**` receives `Cache-Control: public, max-age=3600` plus ETag support; HTML and JavaScript revalidate. Do not add asset fingerprinting or cross-team filename rewriting for this Easter egg.

## 11. Testing and verification

### Baseline

Before implementation, run `npm test` and record the result. The existing extraction and 500-company fixture validation must remain green throughout.

### Pure game tests

- Same seed produces the same spawn/species sequence.
- Fixed-step replay remains identical across different simulated render-frame intervals.
- Creatures stay in normalized bounds after movement steps.
- Active IDs do not duplicate.
- Capture scores only once.
- Streak increments on capture and resets on an uncaptured TTL escape.
- Rarity weighting respects configured caps.
- 20-footer cannot appear before its threshold or during cooldown.
- `?huntForceRare=1` triggers the rare event independently of catalog tuning.
- `huntSeed` is integer-parsed, bounded to the supported PRNG range, and cannot throw on malformed input.
- Pause/resume does not advance elapsed game time unexpectedly.
- A paused, hidden, or offscreen controller makes zero core `step` calls.
- Corrupt or blocked persistence falls back safely.

### Browser interaction checks

- Start via pointer, touch, and keyboard.
- Flashlight follows pointer without page scroll or layout churn.
- Tab focuses creatures; Enter/Space captures them.
- Capture reveal opens, announces itself, dismisses, and returns focus correctly.
- Hold interaction completes and cancels correctly for pointer and keyboard.
- Pause/resume works and the animation stops offscreen or in a hidden tab.
- Reduced-motion mode is fully playable with static target positions and no sweeping rare animation.
- The scroll cue reaches `#about`.
- The real extraction form still submits, displays status, renders candidates, and downloads results.
- No console errors or failed local asset requests.

### Visual QA viewports

- Desktop: 1440×900 and 1280×800.
- Small laptop: 1024×768.
- Mobile: 390×844 and 360×800; landscape mobile: 844×390.
- One screenshot each for idle, active, species reveal, and forced 20-footer.
- Test both fine and coarse pointers where tooling permits.

## 12. Accessibility requirements

- Every creature is a semantic button with a unique accessible position and visible-shape hint without revealing its species; for example, “Unknown wide logo creature, 3 of 6”.
- Visible focus indicator independent of the flashlight color.
- Keyboard focus illuminates the focused creature.
- Keyboard play is intentionally collection rather than pointer aiming: Tab selects an available target and Enter/Space captures it.
- Start, pause, resume, capture, dismiss, and 20-footer hold all have keyboard equivalents.
- `prefers-reduced-motion: reduce` starts with static creatures, removes parallax/rain sweeps, and replaces the 20-footer crossing with a stationary hold target. The user-driven flashlight still follows pointer or focus.
- A persistent **Lights on** control reveals the full playfield and is the default under `prefers-contrast: more`.
- Do not encode rarity or capture state by color alone.
- Maintain WCAG AA contrast for meaningful UI text.
- Provide a polite live region for captures; avoid announcing position updates or ambient motion.
- Game remains optional because normal page scrolling is never trapped.

## 13. Performance budgets

- No new production dependency or build system.
- Maximum eight independently transformed entities, including the rare event. Each creature should be one transformed button with at most one child logo image; decorative frames belong in CSS backgrounds where possible.
- Game controller target: under 20 KB gzip across its modules.
- Desktop background target: 350 KB or less.
- Mobile background target: 220 KB or less.
- Hand and overlay assets combined: 120 KB or less per selected format where practical.
- 20-footer ribbon: 120 KB or less in its selected runtime format.
- Self-hosted fonts: 30 KB or less total.
- Preload only the current viewport’s background; do not preload both desktop and mobile versions.
- Stop `requestAnimationFrame` and ambient animation when the hero is offscreen, paused, reduced-motion static, or the document is hidden.
- Update transforms and CSS variables in batches; no per-frame layout reads.
- Reserve scene dimensions to avoid layout shift.
- Use a CSS-gradient fallback if generated artwork fails to load.
- On 4× CPU throttling with six creatures, a fixed-step/update/render cycle should stay under 4 ms and active play should produce no long task over 50 ms.
- `homepage-smoke.test.mjs` validates every runtime asset against its manifest-declared byte budget. Asset optimization runs manually/repeatably with committed outputs; CI validates rather than regenerates art.

## 14. Delivery phases

### Phase 1 — Functional gray-box

- Final DOM contract and scoped styles.
- CSS-gradient scene with simple geometric placeholder marks and a temporary hand/cursor.
- Deterministic spawn, capture, reveal, score, pause, and scroll behavior.
- Keyboard, touch, and reduced-motion support.
- Unit tests green.
- Complete the real-mark policy/provenance review. No real company mark ships until its manifest entry records the required approval basis; the placeholder catalog remains a shippable fallback.

**Gate:** the game is understandable and fun before any generated art is merged.

### Phase 2 — Visual production

- Generate one background scene and consistent hand poses.
- Integrate the reviewed local catalog of real company marks and its provenance manifest.
- Optimize and integrate runtime assets.
- Tune typography, contrast, flashlight radius, creature speed, and density.

**Gate:** visual consistency at all target viewports within asset budgets.

### Phase 3 — Rare encounter and polish

- Add the 20-footer only after the normal hunt is stable.
- Add capture burst, field-guide copy, subtle fog/rain/ripples, and optional local best score.
- Keep audio out of v1.

**Gate:** rare state is deterministic in QA, interruptible, accessible, and does not dominate ordinary play.

### Phase 4 — Integration verification

- Full extraction regression.
- Browser/mobile/accessibility/performance pass.
- Visual review against the approved mockups.
- Remove dead placeholders and unused assets.
- Document final controls and architecture in the README if the feature ships.

## 15. Acceptance criteria

- [ ] Only one persistent scene exists; no scenery shift or biome loader is implemented.
- [ ] The words **The Webglades** and **Skip game** do not appear in production.
- [ ] **Scroll down to learn more ↓** is present and links to the product explanation.
- [ ] GitHub and **Free & open source** are visible above the fold.
- [ ] Five ordinary species behaviors and the 20-footer are implemented from declarative data.
- [ ] Species names appear after capture, not as permanent target labels.
- [ ] Game works with mouse, touch, keyboard, and reduced motion.
- [ ] Animation pauses offscreen and in background tabs.
- [ ] No cross-origin request is made for company logos, game state, or fonts; approved real marks are served locally.
- [ ] Every real mark has a complete approval/provenance manifest entry and can be disabled without a code change.
- [ ] **Lights on**, pause/resume, and unique keyboard target names work.
- [ ] V1 contains no audio.
- [ ] Existing extractor and fixture tests remain green.
- [ ] Asset and JS budgets are met or any exception is documented with measurements.
- [ ] No new framework, bundler, backend endpoint, or unnecessary abstraction is added.

## 16. Main risks and mitigations

| Risk | Mitigation |
|---|---|
| The Easter egg overwhelms the actual tool | Keep scroll cue persistent; put the functional finder immediately below; avoid long onboarding or game-over loops |
| Generated art is inconsistent across poses | Approve one reference first, generate all poses from it, validate as a set, retain a code-native hand fallback |
| Mobile interaction assumes hover | Use Pointer Events, larger coarse-pointer light and hit targets, and tap-to-move/tap-to-capture behavior |
| Cursor-only game is inaccessible | Real buttons, focus-driven light, keyboard capture, pause, live region, static reduced-motion mode |
| Random rare event cannot be tested | Fixed-step seeded core, guaranteed first encounter, explicit `?huntForceRare=1` QA override |
| Large imagery harms first load | One scene only, responsive AVIF/WebP, byte gates, CSS fallback, no unnecessary preloads |
| Global CSS breaks the extractor | Scope hunt styles and tighten existing broad selectors under owned section classes |
| Parallel teams conflict | Freeze interfaces, use isolated worktrees, assign exclusive path ownership, one homepage integrator |
| Existing extractor work is overwritten | Do not create feature worktrees until existing changes are safely committed on an owner-approved branch; prohibit homepage teams from touching discovery/ranking files |
| Real logos are inaccurate, stale, or imply endorsement | Source exact files from official resources or manually approved Logo Yoink results, serve them locally with provenance, preserve proportions/colors, and add an ownership/non-endorsement note if appropriate |

## 17. Deliberate non-goals

- Multiple scenes, scenery shifts, map progression, or biome loading.
- Recreating or naming the Everglades creator.
- Real animals or wildlife-handling imagery.
- Fetching live extractor results inside the game; real game logos come from a reviewed local catalog.
- Multiplayer, global scores, authentication, server persistence, or analytics requirement.
- Canvas/WebGL, a frontend framework, physics library, or general-purpose game engine.
- Baking UI text or species labels into ImageGen output.
- Replacing or refactoring the extraction pipeline as part of homepage work.

## 18. Review record

This section will record the requested Claude Opus review and the revisions incorporated before the plan is considered ready for implementation.

### Claude Opus review

Reviewed read-only with Claude Opus through the local Claude Code CLI after the initial draft and after the user clarified that recognizable real logos are desirable. Opus agreed with the vanilla DOM/CSS direction and one-scene scope, then identified four items that had to be resolved before contract freeze:

1. Real-logo approval/provenance needed to be a release gate with a removal path, not an optional later note.
2. Variable frame deltas contradicted deterministic replay and rare-event testing.
3. Team 0 and Team 3 had ambiguous shared-file ownership, while `package.json` was unassigned and server MIME work landed too late.
4. Species behavior and real-logo asset metadata were incorrectly assigned to one shared catalog file.

It also recommended defining creature TTL/streak behavior, retaining keyboard focus through capture, uniquely naming keyboard targets, guaranteeing an early 20-footer, simplifying caching and assets, explicitly deciding font/viewport/Playwright behavior, adding a lights-on mode, and making performance budgets testable.

### Revisions applied

- Replaced variable-delta game rules with a fixed 20 ms core step and stable RNG order.
- Replaced a fragile forced seed with `?huntForceRare=1`; guaranteed the first 20-footer at capture five.
- Split behavior into `hunt-species.js` and asset/provenance data into Team 1’s manifest.
- Assigned `package.json`, `src/server.mjs`, wave-0 selector scoping, and merge resolution to Team 0; added a sole-owner conflict map.
- Added 12–20 second creature TTL, streak reset on escape, and explicit off-torch click behavior.
- Kept captured controls focusable with `aria-disabled`, made the reveal a non-modal status, and added unique accessible target names.
- Added **Lights on**, high-contrast behavior, fixed reduced-motion behavior, small-landscape sizing, and a clear H1/metadata decision.
- Converted real-logo handling into Tier A/Tier B approval, provenance, non-endorsement/takedown, and catalog-only removal gates.
- Limited LLM-authored SVG to simple geometry; exact marks come from approved official/local assets, while ImageGen owns illustration assets.
- Reduced production art to one desktop/mobile scene, one midground, two hand poses, creature frames, and the 20-footer; removed the foreground, fog tile, effect sheet, JPEG fallback, and extra logo variants.
- Reused the existing Playwright dependency, kept screenshots out of the repository, simplified static caching, and added cross-origin, asset-budget, fixed-step, hidden-tab, and query-parsing checks.
- Made “no audio in v1” and “one scene only” final decisions.
