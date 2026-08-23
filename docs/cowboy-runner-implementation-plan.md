# Logo Yoink Cowboy Runner

## Summary

Turn the homepage hero into an endless pixel-art cowboy runner while preserving the existing logo finder directly below it. The player rides automatically, jumps to collect logos, loses one of three hearts when hitting a cactus, and gains an occasional lasso power-up that automatically “yoinks” the next three logos. Optional sound effects, keyboard/touch controls, responsive layouts, and deterministic visual-QA states are included.

## Implementation Changes

### Visual direction and assets

- Use the supplied images as style references only; do not crop their composite sprite sheets or reuse their AI-rendered brand marks as production logos.
- Before coding, generate and inspect fresh desktop and mobile gameplay references, following the image-first workflow.
- Generate project-ready pixel-art assets: desert backgrounds, cowboy-and-horse animation frames, cactus variants, lasso pickup, dust, sparkles, and impact effects. Keep UI text such as `YOINK!`, scores, and buttons in HTML/CSS.
- Optimize generated assets with the existing `sharp` dependency and store runtime derivatives under `public/assets/game/`.
- Bundle local SVG marks for Instagram, X, YouTube, TikTok, Pinterest, GitHub, Google, Figma, Slack, Notion, Apple, and Spotify from a pinned Simple Icons revision. Record provenance in a manifest, preserve exact paths/proportions, include a non-endorsement note, and never hotlink or redraw the marks.
- Self-host one licensed pixel display font; retain system fonts for supporting text and accessible controls.

### Homepage and game presentation

- Replace the current opening hero with a full-width desert playfield containing the Logo Yoink title, three-heart HUD, score, best score, lasso counter, sound toggle, pause control, and `START YOINKIN’` action.
- Keep the existing extractor form and ranked results below the game with a persistent `Find a logo ↓` anchor.
- Preserve the current `/api/extract` behavior and all unrelated uncommitted work. Only extend static MIME handling for the new image, font, and manifest formats.
- Use a responsive canvas for scenery, sprites, collisions, particles, and lasso animation; keep buttons, HUD, instructions, score summary, and accessibility announcements as crisp DOM overlays.
- Provide Space, Arrow Up, or W to jump; tap/click inside the playfield to jump; P/Escape to pause; and visible restart and sound controls.
- Scale the world from fixed logical coordinates, use nearest-neighbor rendering, and provide separately composed desktop and mobile backgrounds rather than mechanically cropping one image.

### Game rules

- Runs continue until all three hearts are lost. Hitting a cactus removes one heart and grants 1.25 seconds of flashing invulnerability; the third hit ends the run.
- Score equals continuously increasing distance points plus 250 points per collected logo. Best score persists locally when storage is available.
- Logos appear at jumpable heights and score through rider-token collision. Spawn scheduling must prevent impossible cactus/logo combinations and derive minimum gaps from current speed and jump airtime.
- The world accelerates gradually, with capped speed and obstacle pressure so difficulty rises without becoming unfair.
- The first lasso appears between 12 and 18 seconds; later lassos use a seeded 25–40 second cooldown. Picking one up arms exactly three automatic logo captures.
- While armed, each approaching logo receives a visible rope arc, is pulled toward the rider without requiring a jump, awards the normal 250 points, decrements the counter, and triggers a large `YOINK!` animation. The lasso does not protect against cacti.
- Generate deterministic encounters from a session seed. Support `?gameSeed=<integer>` plus local QA states for lasso, damage, and game-over screenshots.
- Pause simulation when the page is hidden or the game is offscreen. Reduced-motion mode removes screen shake and excessive particles without changing game timing.
- Synthesize short jump, collect, lasso, damage, and game-over effects through Web Audio after the Start gesture. Sound is user-toggleable and the preference is persisted.

### Internal interfaces

- Add a pure game-state module exposing session creation, fixed-step advancement, jump/pause commands, collision resolution, scoring, lasso consumption, and restart.
- Add a browser controller responsible for input, fixed-timestep accumulation, canvas rendering, DOM HUD updates, audio, visibility handling, and responsive sizing.
- Define the logo manifest with `id`, `label`, `file`, `sourceUrl`, `sourceRevision`, `license`, `brandColor`, and `enabled`.
- Keep the extractor frontend isolated in its existing module and retain `POST /api/extract` unchanged.

## Test and Visual-QA Plan

- Add unit tests for deterministic spawning, frame-rate-independent distance, jump limits, forgiving collision boxes, single-hit invulnerability, three-heart game over, logo scoring, lasso pickup, exactly three auto-yoinks, and safe obstacle spacing.
- Test keyboard, pointer, and touch-equivalent controls; pause/resume; restart; sound toggling; local-storage failures; reduced motion; and mobile resizing.
- Run the complete existing `npm test` suite and manually verify the original logo-extraction form still submits and renders results.
- Use Playwright to capture seeded start, normal-running, active-lasso, damage, and game-over states at 1440×900, 1280×720, and 390×844.
- Visually inspect every screenshot for sprite sharpness, readable HUD hierarchy, unclipped controls, logo clarity, ground alignment, collision feedback, mobile tap space, and a clean transition into the finder. Iterate on assets, spacing, scale, and contrast until those captures are visually sound.

## Assumptions

- The game is an engaging homepage introduction, not a replacement for the actual logo-finding product.
- No leaderboard, accounts, server persistence, multiplayer, music, or additional biomes are included.
- The supplied images remain design references; fresh generated artwork and locally sourced exact logo paths become the production assets.
- Existing uncommitted changes and intentionally deleted concept files remain untouched unless a direct overlap is unavoidable.
